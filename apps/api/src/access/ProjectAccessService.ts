import { randomUUID } from 'crypto'
import type {
    JWTPayload,
    OperationLogEntry,
    Project,
    ProjectInvitation,
    ProjectMember,
    ProjectPermission,
    ProjectRoleDefinition,
} from '@openbase/core'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, nowISO } from '@openbase/core'
import type Redis from 'ioredis'
import type { OperationsLogService } from '../ops/OperationsLogService.js'
import type { PlatformUserRepository } from '../platform/PlatformUserRepository.js'
import type { ProjectService } from '../projects/ProjectService.js'

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

const ALL_PERMISSIONS: ProjectPermission[] = [
    'project.read',
    'project.delete',
    'tables.read',
    'tables.write',
    'tables.manage',
    'storage.read',
    'storage.write',
    'storage.manage',
    'auth.read',
    'auth.manage',
    'webhooks.read',
    'webhooks.manage',
    'migrations.read',
    'migrations.manage',
    'logs.read',
    'audit.read',
    'settings.read',
    'settings.manage',
    'members.read',
    'members.manage',
    'roles.read',
    'roles.manage',
]

const SYSTEM_ROLES: Record<string, ProjectRoleDefinition> = {
    owner: {
        key: 'owner',
        name: 'Owner',
        description: 'Full access to every project resource, member, and setting.',
        permissions: ALL_PERMISSIONS,
        system: true,
    },
    admin: {
        key: 'admin',
        name: 'Admin',
        description: 'Manage schemas, auth users, storage, webhooks, and settings.',
        permissions: [
            'project.read',
            'tables.read',
            'tables.write',
            'tables.manage',
            'storage.read',
            'storage.write',
            'storage.manage',
            'auth.read',
            'auth.manage',
            'webhooks.read',
            'webhooks.manage',
            'migrations.read',
            'migrations.manage',
            'logs.read',
            'audit.read',
            'settings.read',
            'settings.manage',
            'members.read',
            'roles.read',
        ],
        system: true,
    },
    editor: {
        key: 'editor',
        name: 'Editor',
        description: 'Write access to data, storage, and auth without changing project governance.',
        permissions: [
            'project.read',
            'tables.read',
            'tables.write',
            'storage.read',
            'storage.write',
            'auth.read',
            'auth.manage',
            'webhooks.read',
            'migrations.read',
            'logs.read',
            'audit.read',
            'settings.read',
        ],
        system: true,
    },
    viewer: {
        key: 'viewer',
        name: 'Viewer',
        description: 'Read-only access to project resources and audit history.',
        permissions: [
            'project.read',
            'tables.read',
            'storage.read',
            'auth.read',
            'webhooks.read',
            'migrations.read',
            'logs.read',
            'audit.read',
            'settings.read',
        ],
        system: true,
    },
}

export interface ProjectAccessContext {
    project: Project
    role: ProjectRoleDefinition
    member: ProjectMember | null
    principal: 'owner' | 'member'
}

export class ProjectAccessService {
    constructor(
        private readonly redis: Redis,
        private readonly projectService: ProjectService,
        private readonly platformUsers: PlatformUserRepository,
        private readonly operationsLogService: OperationsLogService,
        private readonly dashboardUrl: string,
        private readonly sendEmail?: (to: string, subject: string, html: string) => Promise<void>
    ) { }

    async getProjectsForUser(userId: string): Promise<Project[]> {
        const [owned, membershipIds] = await Promise.all([
            this.projectService.getProjectsByOwner(userId),
            this.redis.smembers(this.getMemberProjectsKey(userId)),
        ])

        const seen = new Set(owned.map(project => project.id))
        const projects = [...owned]
        for (const projectId of membershipIds) {
            if (seen.has(projectId)) {
                continue
            }

            const project = await this.getProjectWithDefaults(projectId).catch(() => null)
            if (!project) {
                continue
            }

            seen.add(project.id)
            projects.push(project)
        }

        return projects.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    }

    async getProjectWithDefaults(projectId: string): Promise<Project> {
        const project = await this.projectService.getProject(projectId)
        return this.ensureProjectDefaults(project)
    }

    async listRoles(projectId: string): Promise<ProjectRoleDefinition[]> {
        const project = await this.getProjectWithDefaults(projectId)
        return Object.values(project.roles || {}).sort((left, right) => left.name.localeCompare(right.name))
    }

    async listMembers(projectId: string): Promise<Array<ProjectMember & { role: ProjectRoleDefinition; owner?: boolean }>> {
        const project = await this.getProjectWithDefaults(projectId)
        const owner = await this.platformUsers.findById(project.ownerId)

        const members = Object.values(project.members || {})
            .map(member => ({
                ...member,
                role: this.resolveRole(project, member.roleKey),
                owner: false,
            }))
            .sort((left, right) => left.email.localeCompare(right.email))

        if (owner) {
            members.unshift({
                userId: owner.id,
                email: owner.email,
                roleKey: 'owner',
                addedAt: project.createdAt,
                addedBy: owner.id,
                role: SYSTEM_ROLES.owner,
                owner: true,
            })
        }

        return members
    }

    async listInvitations(projectId: string): Promise<ProjectInvitation[]> {
        const ids = await this.redis.smembers(this.getProjectInviteSetKey(projectId))
        const invites: ProjectInvitation[] = []

        for (const id of ids) {
            const invite = await this.readInvitation(projectId, id)
            if (!invite) {
                await this.redis.srem(this.getProjectInviteSetKey(projectId), id)
                continue
            }

            invites.push(invite)
        }

        return invites.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    }

    async inviteMember(
        projectId: string,
        actorUserId: string,
        email: string,
        roleKey: string
    ): Promise<ProjectInvitation & { inviteUrl: string; delivery: 'email' | 'manual' }> {
        const project = await this.getProjectWithDefaults(projectId)
        this.assertRoleAssignable(project, roleKey)

        if (project.ownerId === actorUserId) {
            // owner is always allowed
        } else {
            const actor = await this.assertPlatformPermission(projectId, {
                role: 'platform_user',
                sub: actorUserId,
            }, 'members.manage')
            if (!actor) {
                throw new ForbiddenError('Membership management requires additional permissions')
            }
        }

        if (this.findMemberByEmail(project, email)) {
            throw new ConflictError(`"${email}" already has project access`)
        }

        const id = randomUUID()
        const token = randomUUID()
        const invite: ProjectInvitation = {
            id,
            token,
            projectId,
            email: email.trim().toLowerCase(),
            roleKey,
            invitedBy: actorUserId,
            createdAt: nowISO(),
            expiresAt: new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString(),
        }

        await this.writeInvitation(invite)

        let delivery: 'email' | 'manual' = 'manual'
        if (this.sendEmail) {
            const inviteUrl = this.buildInvitationUrl(token)
            try {
                await this.sendEmail(
                    invite.email,
                    `Invitation to join ${project.name} on OpenBase`,
                    `
                      <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
                        <h2>You were invited to ${project.name}</h2>
                        <p>Accept this invitation to join the project with the <strong>${this.resolveRole(project, roleKey).name}</strong> role.</p>
                        <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#3ecf8e;color:#08100b;text-decoration:none;border-radius:8px;">Accept invitation</a>
                      </div>
                    `
                )
                delivery = 'email'
            } catch {
                delivery = 'manual'
            }
        }

        await this.recordSecurityEvent(project.id, 'success', 'Project invitation created', {
            action: 'member.invite',
            email: invite.email,
            roleKey,
            invitedBy: actorUserId,
            delivery,
        })

        return {
            ...invite,
            inviteUrl: this.buildInvitationUrl(token),
            delivery,
        }
    }

    async acceptInvitation(token: string, actorUserId: string): Promise<ProjectAccessContext> {
        const mapping = await this.redis.get(this.getInviteLookupKey(token))
        if (!mapping) {
            throw new NotFoundError('Invitation')
        }

        const [projectId, invitationId] = mapping.split(':')
        const invite = await this.readInvitation(projectId, invitationId)
        if (!invite) {
            throw new NotFoundError('Invitation')
        }

        if (invite.revokedAt) {
            throw new ForbiddenError('Invitation has been revoked')
        }

        if (invite.acceptedAt) {
            throw new ConflictError('Invitation has already been accepted')
        }

        if (new Date(invite.expiresAt).getTime() <= Date.now()) {
            throw new ForbiddenError('Invitation has expired')
        }

        const platformUser = await this.platformUsers.findById(actorUserId)
        if (!platformUser || platformUser.email.toLowerCase() !== invite.email.toLowerCase()) {
            throw new ForbiddenError('Invitation email does not match the signed-in account')
        }

        const project = await this.getProjectWithDefaults(projectId)
        const member: ProjectMember = {
            userId: platformUser.id,
            email: platformUser.email,
            roleKey: invite.roleKey,
            addedAt: nowISO(),
            addedBy: invite.invitedBy,
        }

        project.members = {
            ...(project.members || {}),
            [member.userId]: member,
        }
        await this.projectService.updateProject(project.id, { members: project.members })
        await this.redis.sadd(this.getMemberProjectsKey(member.userId), project.id)

        invite.acceptedAt = nowISO()
        await this.writeInvitation(invite)

        await this.recordSecurityEvent(project.id, 'success', 'Project invitation accepted', {
            action: 'member.accept',
            invitationId: invite.id,
            userId: member.userId,
            roleKey: member.roleKey,
        })

        return {
            project,
            role: this.resolveRole(project, member.roleKey),
            member,
            principal: 'member',
        }
    }

    async revokeInvitation(projectId: string, invitationId: string, actorUserId: string): Promise<ProjectInvitation> {
        await this.assertPlatformPermission(projectId, { role: 'platform_user', sub: actorUserId }, 'members.manage')
        const invite = await this.readInvitation(projectId, invitationId)
        if (!invite) {
            throw new NotFoundError('Invitation')
        }

        invite.revokedAt = nowISO()
        await this.writeInvitation(invite)
        await this.recordSecurityEvent(projectId, 'warning', 'Project invitation revoked', {
            action: 'member.invitation.revoke',
            invitationId,
            revokedBy: actorUserId,
            email: invite.email,
        })

        return invite
    }

    async updateMemberRole(projectId: string, actorUserId: string, memberUserId: string, roleKey: string): Promise<ProjectMember> {
        const access = await this.assertPlatformPermission(projectId, { role: 'platform_user', sub: actorUserId }, 'members.manage')
        const project = access.project
        this.assertRoleAssignable(project, roleKey)

        const existing = project.members?.[memberUserId]
        if (!existing) {
            throw new NotFoundError('Member')
        }

        const updated: ProjectMember = {
            ...existing,
            roleKey,
        }
        project.members = {
            ...(project.members || {}),
            [memberUserId]: updated,
        }
        await this.projectService.updateProject(project.id, { members: project.members })
        await this.recordSecurityEvent(project.id, 'success', 'Project member role updated', {
            action: 'member.role.update',
            memberUserId,
            roleKey,
            updatedBy: actorUserId,
        })
        return updated
    }

    async removeMember(projectId: string, actorUserId: string, memberUserId: string): Promise<void> {
        const access = await this.assertPlatformPermission(projectId, { role: 'platform_user', sub: actorUserId }, 'members.manage')
        const project = access.project
        if (memberUserId === project.ownerId) {
            throw new ValidationError('The owner cannot be removed from the project')
        }

        const existing = project.members?.[memberUserId]
        if (!existing) {
            throw new NotFoundError('Member')
        }

        const nextMembers = { ...(project.members || {}) }
        delete nextMembers[memberUserId]
        await this.projectService.updateProject(project.id, { members: nextMembers })
        await this.redis.srem(this.getMemberProjectsKey(memberUserId), project.id)
        await this.recordSecurityEvent(project.id, 'warning', 'Project member removed', {
            action: 'member.remove',
            memberUserId,
            removedBy: actorUserId,
        })
    }

    async upsertRole(projectId: string, actorUserId: string, role: ProjectRoleDefinition): Promise<ProjectRoleDefinition> {
        const access = await this.assertPlatformPermission(projectId, { role: 'platform_user', sub: actorUserId }, 'roles.manage')
        const project = access.project
        this.assertCustomRole(role)

        const nextRoles = {
            ...(project.roles || {}),
            [role.key]: {
                ...role,
                permissions: [...new Set(role.permissions)],
                system: false,
            },
        }

        await this.projectService.updateProject(project.id, { roles: nextRoles })
        await this.recordSecurityEvent(project.id, 'success', 'Project role saved', {
            action: 'role.save',
            roleKey: role.key,
            updatedBy: actorUserId,
        })

        return nextRoles[role.key]
    }

    async deleteRole(projectId: string, actorUserId: string, roleKey: string): Promise<void> {
        const access = await this.assertPlatformPermission(projectId, { role: 'platform_user', sub: actorUserId }, 'roles.manage')
        const project = access.project

        if (SYSTEM_ROLES[roleKey]) {
            throw new ValidationError('System roles cannot be deleted')
        }

        if (!project.roles?.[roleKey]) {
            throw new NotFoundError('Role')
        }

        const inUse = Object.values(project.members || {}).some(member => member.roleKey === roleKey)
        if (inUse) {
            throw new ValidationError('Remove or reassign members before deleting this role')
        }

        const nextRoles = { ...(project.roles || {}) }
        delete nextRoles[roleKey]
        await this.projectService.updateProject(project.id, { roles: nextRoles })
        await this.recordSecurityEvent(project.id, 'warning', 'Project role deleted', {
            action: 'role.delete',
            roleKey,
            deletedBy: actorUserId,
        })
    }

    async cleanupProject(projectId: string): Promise<void> {
        const project = await this.getProjectWithDefaults(projectId)
        const invitationIds = await this.redis.smembers(this.getProjectInviteSetKey(projectId))
        const multi = this.redis.multi()

        for (const member of Object.values(project.members || {})) {
            multi.srem(this.getMemberProjectsKey(member.userId), projectId)
        }

        for (const invitationId of invitationIds) {
            const invite = await this.readInvitation(projectId, invitationId)
            multi.del(this.getInvitationKey(projectId, invitationId))
            if (invite) {
                multi.del(this.getInviteLookupKey(invite.token))
            }
        }

        multi.del(this.getProjectInviteSetKey(projectId))
        await multi.exec()
    }

    async assertPlatformPermission(
        projectId: string,
        user: Pick<JWTPayload, 'role' | 'sub'>,
        permission: ProjectPermission
    ): Promise<ProjectAccessContext> {
        if (user.role !== 'platform_user' || !user.sub) {
            throw new ForbiddenError('Platform user token required')
        }

        const project = await this.getProjectWithDefaults(projectId)
        if (project.ownerId === user.sub) {
            return {
                project,
                role: SYSTEM_ROLES.owner,
                member: null,
                principal: 'owner',
            }
        }

        const member = project.members?.[user.sub]
        if (!member) {
            throw new ForbiddenError('You do not have access to this project')
        }

        const role = this.resolveRole(project, member.roleKey)
        if (!role.permissions.includes(permission)) {
            throw new ForbiddenError(`Missing "${permission}" permission`)
        }

        return {
            project,
            role,
            member,
            principal: 'member',
        }
    }

    async ensureProjectDefaults(project: Project): Promise<Project> {
        const roles = this.getMergedRoles(project)
        const members = project.members || {}
        if (project.roles && project.members) {
            return {
                ...project,
                roles,
                members,
            }
        }

        return this.projectService.updateProject(project.id, {
            roles,
            members,
        })
    }

    resolveRole(project: Project, roleKey: string): ProjectRoleDefinition {
        const role = this.getMergedRoles(project)[roleKey]
        if (!role) {
            throw new ValidationError(`Unknown role "${roleKey}"`)
        }

        return role
    }

    buildInvitationUrl(token: string): string {
        return `${this.dashboardUrl.replace(/\/$/, '')}/invite?token=${encodeURIComponent(token)}`
    }

    private getMergedRoles(project: Project): Record<string, ProjectRoleDefinition> {
        return {
            ...SYSTEM_ROLES,
            ...(project.roles || {}),
        }
    }

    private findMemberByEmail(project: Project, email: string): ProjectMember | undefined {
        return Object.values(project.members || {}).find(member => member.email.toLowerCase() === email.trim().toLowerCase())
    }

    private assertRoleAssignable(project: Project, roleKey: string): void {
        if (roleKey === 'owner') {
            throw new ValidationError('The owner role cannot be assigned through invitations')
        }

        const role = this.resolveRole(project, roleKey)
        if (!role) {
            throw new ValidationError(`Unknown role "${roleKey}"`)
        }
    }

    private assertCustomRole(role: ProjectRoleDefinition): void {
        if (!role.key.match(/^[a-z][a-z0-9_-]*$/)) {
            throw new ValidationError('Role keys must start with a letter and contain only lowercase letters, numbers, dashes, or underscores')
        }

        if (SYSTEM_ROLES[role.key] || role.system) {
            throw new ValidationError('System roles cannot be overwritten')
        }

        const invalidPermissions = role.permissions.filter(permission => !ALL_PERMISSIONS.includes(permission))
        if (invalidPermissions.length > 0) {
            throw new ValidationError(`Unknown permissions: ${invalidPermissions.join(', ')}`)
        }
    }

    private async writeInvitation(invite: ProjectInvitation): Promise<void> {
        const key = this.getInvitationKey(invite.projectId, invite.id)
        await this.redis.multi()
            .set(key, JSON.stringify(invite), 'EX', INVITE_TTL_SECONDS)
            .sadd(this.getProjectInviteSetKey(invite.projectId), invite.id)
            .set(this.getInviteLookupKey(invite.token), `${invite.projectId}:${invite.id}`, 'EX', INVITE_TTL_SECONDS)
            .exec()
    }

    private async readInvitation(projectId: string, invitationId: string): Promise<ProjectInvitation | null> {
        const raw = await this.redis.get(this.getInvitationKey(projectId, invitationId))
        if (!raw) {
            return null
        }

        return JSON.parse(raw) as ProjectInvitation
    }

    private async recordSecurityEvent(
        projectId: string,
        level: OperationLogEntry['level'],
        message: string,
        metadata: Record<string, unknown>
    ): Promise<void> {
        await this.operationsLogService.record({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            projectId,
            scope: 'security',
            level,
            message,
            metadata,
            timestamp: nowISO(),
        })
    }

    private getProjectInviteSetKey(projectId: string): string {
        return `project:${projectId}:invites`
    }

    private getInvitationKey(projectId: string, invitationId: string): string {
        return `project:${projectId}:invite:${invitationId}`
    }

    private getInviteLookupKey(token: string): string {
        return `project:invite:${token}`
    }

    private getMemberProjectsKey(userId: string): string {
        return `member:${userId}:projects`
    }
}
