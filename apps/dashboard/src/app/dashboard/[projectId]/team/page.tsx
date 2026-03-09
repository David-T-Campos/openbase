'use client'

import {
    projectInvitationSchema,
    projectMemberSchema,
    projectPermissionSchema,
    projectRoleDefinitionSchema,
} from '@openbase/core'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { z } from 'zod'
import { Copy, MailPlus, ShieldPlus, Trash2, UserMinus, Users2 } from 'lucide-react'
import { authenticatedFetch, getApiUrl, readApiEnvelope } from '../../../../lib/platformApi'

const memberWithRoleSchema = projectMemberSchema.extend({
    role: projectRoleDefinitionSchema,
    owner: z.boolean().optional(),
})

const invitationWithUrlSchema = projectInvitationSchema.extend({
    inviteUrl: z.string().url(),
    delivery: z.enum(['email', 'manual']),
})

type ProjectRole = z.infer<typeof projectRoleDefinitionSchema>
type ProjectMember = z.infer<typeof memberWithRoleSchema>
type ProjectInvitation = z.infer<typeof invitationWithUrlSchema>

const permissionGroups = [
    {
        label: 'Project',
        permissions: ['project.read', 'project.delete', 'settings.read', 'settings.manage'] as const,
    },
    {
        label: 'Data',
        permissions: ['tables.read', 'tables.write', 'tables.manage', 'migrations.read', 'migrations.manage'] as const,
    },
    {
        label: 'Storage',
        permissions: ['storage.read', 'storage.write', 'storage.manage'] as const,
    },
    {
        label: 'Security',
        permissions: ['auth.read', 'auth.manage', 'members.read', 'members.manage', 'roles.read', 'roles.manage', 'audit.read', 'logs.read'] as const,
    },
    {
        label: 'Delivery',
        permissions: ['webhooks.read', 'webhooks.manage'] as const,
    },
]

export default function TeamPage() {
    const params = useParams()
    const projectId = params.projectId as string

    const [roles, setRoles] = useState<ProjectRole[]>([])
    const [members, setMembers] = useState<ProjectMember[]>([])
    const [invitations, setInvitations] = useState<ProjectInvitation[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRoleKey, setInviteRoleKey] = useState('viewer')
    const [inviteLoading, setInviteLoading] = useState(false)
    const [roleDraft, setRoleDraft] = useState({
        key: '',
        name: '',
        description: '',
        permissions: ['project.read', 'tables.read'] as string[],
    })
    const [roleSaving, setRoleSaving] = useState(false)

    useEffect(() => {
        void loadAccessState()
    }, [projectId])

    const roleOptions = useMemo(
        () => roles.filter(role => role.key !== 'owner'),
        [roles],
    )

    const systemRoleCount = useMemo(
        () => roles.filter(role => role.system).length,
        [roles],
    )

    const loadAccessState = async () => {
        setLoading(true)
        setError('')

        try {
            const [rolesResponse, membersResponse, invitationsResponse] = await Promise.all([
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/roles`),
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/members`),
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/invitations`),
            ])

            const [rolesData, membersData, invitationsData] = await Promise.all([
                readApiEnvelope(rolesResponse, z.array(projectRoleDefinitionSchema)),
                readApiEnvelope(membersResponse, z.array(memberWithRoleSchema)),
                readApiEnvelope(invitationsResponse, z.array(projectInvitationSchema)),
            ])

            setRoles(rolesData)
            setMembers(membersData)
            setInvitations(invitationsData.map(invite => ({
                ...invite,
                inviteUrl: `${window.location.origin}/invite?token=${invite.token}`,
                delivery: 'manual',
            })))
            setInviteRoleKey(rolesData.find(role => role.key === 'viewer')?.key || rolesData[0]?.key || 'viewer')
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    const handleInvite = async () => {
        if (!inviteEmail || !inviteRoleKey) {
            return
        }

        setInviteLoading(true)
        setError('')

        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/invitations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail, roleKey: inviteRoleKey }),
            })
            const invitation = await readApiEnvelope(response, invitationWithUrlSchema)
            setInvitations(current => [invitation, ...current.filter(item => item.id !== invitation.id)])
            setInviteEmail('')
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setInviteLoading(false)
        }
    }

    const handleSaveRole = async () => {
        if (!roleDraft.key || !roleDraft.name || roleDraft.permissions.length === 0) {
            setError('Role key, role name, and at least one permission are required.')
            return
        }

        setRoleSaving(true)
        setError('')

        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/roles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(roleDraft),
            })
            const role = await readApiEnvelope(response, projectRoleDefinitionSchema)
            setRoles(current => [...current.filter(item => item.key !== role.key), role].sort((left, right) => left.name.localeCompare(right.name)))
            setRoleDraft({
                key: '',
                name: '',
                description: '',
                permissions: ['project.read', 'tables.read'],
            })
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setRoleSaving(false)
        }
    }

    const handleUpdateMemberRole = async (userId: string, roleKey: string) => {
        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/members/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roleKey }),
            })
            const member = await readApiEnvelope(response, projectMemberSchema)
            const role = roles.find(candidate => candidate.key === member.roleKey)
            setMembers(current => current.map(item => item.userId === userId && role ? { ...item, ...member, role } : item))
        } catch (nextError) {
            setError((nextError as Error).message)
        }
    }

    const handleRemoveMember = async (userId: string) => {
        try {
            await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/members/${userId}`, {
                method: 'DELETE',
            })
            setMembers(current => current.filter(member => member.userId !== userId))
        } catch (nextError) {
            setError((nextError as Error).message)
        }
    }

    const handleRevokeInvitation = async (invitationId: string) => {
        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/invitations/${invitationId}`, {
                method: 'DELETE',
            })
            const revoked = await readApiEnvelope(response, projectInvitationSchema)
            setInvitations(current => current.map(item => item.id === invitationId ? { ...item, ...revoked } : item))
        } catch (nextError) {
            setError((nextError as Error).message)
        }
    }

    const handleDeleteRole = async (roleKey: string) => {
        try {
            await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/access/roles/${roleKey}`, {
                method: 'DELETE',
            })
            setRoles(current => current.filter(role => role.key !== roleKey))
        } catch (nextError) {
            setError((nextError as Error).message)
        }
    }

    const togglePermission = (permission: string) => {
        setRoleDraft(current => ({
            ...current,
            permissions: current.permissions.includes(permission)
                ? current.permissions.filter(value => value !== permission)
                : [...current.permissions, permission],
        }))
    }

    return (
        <div className="shell py-8 md:py-10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Team access</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-7 subtle">
                        Invite operators, assign custom project roles, and keep a clean access ledger for everyone who can touch this project.
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="panel-soft px-4 py-4">
                        <div className="text-xs uppercase tracking-[0.14em] subtle">Members</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{members.length}</div>
                    </div>
                    <div className="panel-soft px-4 py-4">
                        <div className="text-xs uppercase tracking-[0.14em] subtle">Roles</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{roles.length}</div>
                    </div>
                    <div className="panel-soft px-4 py-4">
                        <div className="text-xs uppercase tracking-[0.14em] subtle">Pending invites</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{invitations.filter(invite => !invite.revokedAt && !invite.acceptedAt).length}</div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                    {error}
                </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <section className="panel p-6">
                    <div className="flex items-center gap-3">
                        <MailPlus className="h-5 w-5 text-[color:var(--accent)]" />
                        <div>
                            <div className="text-lg font-semibold text-white">Invite operator</div>
                            <div className="mt-1 text-sm subtle">Send a role-bound invitation link or copy it manually when outbound mail is unavailable.</div>
                        </div>
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                        <div>
                            <label className="label">Email</label>
                            <input
                                value={inviteEmail}
                                onChange={event => setInviteEmail(event.target.value)}
                                placeholder="operator@example.com"
                                className="input"
                            />
                        </div>
                        <div>
                            <label className="label">Role</label>
                            <select
                                value={inviteRoleKey}
                                onChange={event => setInviteRoleKey(event.target.value)}
                                className="input"
                            >
                                {roleOptions.map(role => (
                                    <option key={role.key} value={role.key}>
                                        {role.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mt-4 flex gap-3">
                        <button type="button" onClick={handleInvite} disabled={inviteLoading} className="btn btn-primary">
                            <MailPlus className="h-4 w-4" />
                            {inviteLoading ? 'Inviting...' : 'Create invitation'}
                        </button>
                        <button type="button" onClick={loadAccessState} className="btn btn-secondary">
                            Refresh
                        </button>
                    </div>

                    <div className="mt-6 space-y-3">
                        {loading ? (
                            <div className="panel-soft h-24 animate-pulse" />
                        ) : invitations.length === 0 ? (
                            <div className="panel-soft px-4 py-4 text-sm subtle">No invitations have been created yet.</div>
                        ) : (
                            invitations.map(invitation => (
                                <div key={invitation.id} className="panel-soft flex flex-col gap-4 px-4 py-4">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <div className="font-medium text-white">{invitation.email}</div>
                                            <div className="mt-2 text-xs subtle">
                                                Role {invitation.roleKey} • Expires {new Date(invitation.expiresAt).toLocaleString()}
                                            </div>
                                            <div className="mt-2 text-xs subtle">
                                                {invitation.acceptedAt
                                                    ? `Accepted ${new Date(invitation.acceptedAt).toLocaleString()}`
                                                    : invitation.revokedAt
                                                        ? `Revoked ${new Date(invitation.revokedAt).toLocaleString()}`
                                                        : 'Pending acceptance'}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button type="button" onClick={() => navigator.clipboard.writeText(invitation.inviteUrl)} className="btn btn-secondary h-9 min-h-0 px-3">
                                                <Copy className="h-4 w-4" />
                                                Copy link
                                            </button>
                                            {!invitation.acceptedAt && !invitation.revokedAt && (
                                                <button type="button" onClick={() => handleRevokeInvitation(invitation.id)} className="btn btn-danger h-9 min-h-0 px-3">
                                                    <Trash2 className="h-4 w-4" />
                                                    Revoke
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <section className="panel-muted p-6">
                    <div className="flex items-center gap-3">
                        <ShieldPlus className="h-5 w-5 text-[color:var(--accent)]" />
                        <div>
                            <div className="text-lg font-semibold text-white">Role composer</div>
                            <div className="mt-1 text-sm subtle">System roles stay locked. Everything else is yours to shape around how your team actually works.</div>
                        </div>
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="label">Role key</label>
                            <input
                                value={roleDraft.key}
                                onChange={event => setRoleDraft(current => ({ ...current, key: event.target.value.toLowerCase() }))}
                                placeholder="ops_editor"
                                className="input"
                            />
                        </div>
                        <div>
                            <label className="label">Role name</label>
                            <input
                                value={roleDraft.name}
                                onChange={event => setRoleDraft(current => ({ ...current, name: event.target.value }))}
                                placeholder="Ops editor"
                                className="input"
                            />
                        </div>
                    </div>

                    <div className="mt-4">
                        <label className="label">Description</label>
                        <textarea
                            value={roleDraft.description}
                            onChange={event => setRoleDraft(current => ({ ...current, description: event.target.value }))}
                            placeholder="What this role is allowed to do."
                            className="input min-h-[110px]"
                        />
                    </div>

                    <div className="mt-5 grid gap-4">
                        {permissionGroups.map(group => (
                            <div key={group.label} className="panel-soft p-4">
                                <div className="text-xs uppercase tracking-[0.16em] subtle">{group.label}</div>
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    {group.permissions.map(permission => (
                                        <label key={permission} className="inline-flex items-center gap-3 rounded-[10px] border border-[color:var(--line)] px-3 py-3 text-sm text-white">
                                            <input
                                                type="checkbox"
                                                checked={roleDraft.permissions.includes(permission)}
                                                onChange={() => togglePermission(permission)}
                                                className="h-4 w-4 rounded border-[color:var(--line)] bg-[color:var(--panel-soft)] accent-[color:var(--accent)]"
                                            />
                                            {permission}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-5 flex gap-3">
                        <button type="button" onClick={handleSaveRole} disabled={roleSaving} className="btn btn-primary">
                            {roleSaving ? 'Saving role...' : 'Save custom role'}
                        </button>
                        <div className="text-sm subtle self-center">{systemRoleCount} system roles stay pinned.</div>
                    </div>
                </section>
            </div>

            <section className="panel mt-6 overflow-hidden">
                <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <Users2 className="h-4 w-4 text-[color:var(--accent)]" />
                            <div className="text-lg font-semibold text-white">Access ledger</div>
                        </div>
                        <div className="mt-1 text-sm subtle">Live project operators with their current role assignments.</div>
                    </div>
                    <div className="text-xs uppercase tracking-[0.16em] subtle">Permissions follow the selected role instantly.</div>
                </div>

                {loading ? (
                    <div className="grid gap-3 p-6">
                        {[1, 2, 3].map(item => (
                            <div key={item} className="panel-soft h-20 animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <div className="divide-y divide-[color:var(--line)]">
                        {members.map(member => (
                            <div key={member.userId} className="grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1fr)_220px_180px]">
                                <div className="min-w-0">
                                    <div className="truncate text-base font-semibold text-white">{member.email}</div>
                                    <div className="mt-2 font-mono text-xs subtle">{member.userId}</div>
                                    <div className="mt-3 text-xs subtle">
                                        Added {new Date(member.addedAt).toLocaleString()}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs uppercase tracking-[0.14em] subtle">Role</div>
                                    {member.owner ? (
                                        <div className="status-badge mt-2 text-[color:var(--success)]">
                                            <span className="status-dot" />
                                            Owner
                                        </div>
                                    ) : (
                                        <select
                                            value={member.roleKey}
                                            onChange={event => void handleUpdateMemberRole(member.userId, event.target.value)}
                                            className="input mt-2"
                                        >
                                            {roleOptions.map(role => (
                                                <option key={role.key} value={role.key}>
                                                    {role.name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                <div className="flex items-start justify-end">
                                    {!member.owner && (
                                        <button type="button" onClick={() => handleRemoveMember(member.userId)} className="btn btn-danger h-10 min-h-0 px-3">
                                            <UserMinus className="h-4 w-4" />
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="panel mt-6 overflow-hidden">
                <div className="panel-header px-6 py-4">
                    <div className="text-lg font-semibold text-white">Role inventory</div>
                    <div className="mt-1 text-sm subtle">Built-in roles remain immutable. Custom roles can be removed once no members depend on them.</div>
                </div>

                <div className="divide-y divide-[color:var(--line)]">
                    {roles.map(role => (
                        <div key={role.key} className="grid gap-4 px-6 py-5 lg:grid-cols-[220px_minmax(0,1fr)_140px]">
                            <div>
                                <div className="text-base font-semibold text-white">{role.name}</div>
                                <div className="mt-2 font-mono text-xs subtle">{role.key}</div>
                                {role.system && (
                                    <div className="status-badge mt-3 text-[color:var(--accent)]">
                                        <span className="status-dot" />
                                        System role
                                    </div>
                                )}
                            </div>
                            <div>
                                <div className="text-sm subtle">{role.description || 'No description supplied.'}</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {role.permissions.map(permission => (
                                        <span key={permission} className="rounded-full border border-[color:var(--line)] px-3 py-1 text-[11px] uppercase tracking-[0.12em] subtle">
                                            {permission}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-start justify-end">
                                {!role.system && (
                                    <button type="button" onClick={() => handleDeleteRole(role.key)} className="btn btn-danger h-10 min-h-0 px-3">
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}
