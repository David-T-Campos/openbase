# OQL and Functions

This document covers the two advanced programmable surfaces in OpenBase:

- OpenBase Query Language (OQL)
- the server-side Functions runtime

## OQL

OQL is a pipe-based query language designed around OpenBase's Telegram-backed data model. It deliberately avoids pretending to be SQL while still supporting the core relational workflows OpenBase can execute reliably.

### Clause order

An OQL query starts with `from` and then chains clauses with `|`.

```txt
from posts
| join authors on posts.author_id = authors.id
| where posts.status = 'published'
| select posts.title as title, authors.name as author
| order by posts.title asc
| limit 10
```

Supported clauses:

- `from <table> [alias]`
- `join <table> [alias] on <condition>`
- `left join <table> [alias] on <condition>`
- `where <condition>`
- `select <projection>`
- `group by <references>`
- `order by <reference> [asc|desc]`
- `limit <number>`

### Conditions

Conditions support:

- `=`
- `!=`
- `>`
- `>=`
- `<`
- `<=`
- `like`
- `ilike`
- `in`
- `is`
- `and`
- `or`
- parentheses

Examples:

```txt
where posts.status = 'published' and posts.views >= 100
where posts.author_id in ['author-1', 'author-2']
where posts.deleted_at is null
```

### Projections and aggregates

Supported aggregate functions:

- `count`
- `sum`
- `avg`
- `min`
- `max`

Examples:

```txt
select *
select posts.id, posts.title
select posts.title as title, authors.name as author
select authors.name, count(posts.id) as total_posts
```

### Where OQL runs

OQL is available from:

- dashboard editor: `/dashboard/:projectId/oql`
- API: `POST /api/v1/:projectId/oql`
- JS SDK: `client.oql(query)`
- admin SDK: `admin.oql(query)`

### OQL result shape

```ts
type OqlQueryResult = {
  query: string
  columns: Array<{
    key: string
    label: string
    source: string | null
    aggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' | null
  }>
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  sourceTables: string[]
}
```

### OQL notes

- OQL applies the same table access and row-level security rules as the rest API.
- Joins are project-local; there is no cross-project querying.
- Query execution is optimized for OpenBase's indexed JSON row model, not arbitrary SQL semantics.

## Functions runtime

OpenBase Functions let you deploy project-scoped JavaScript or TypeScript handlers that run inside the OpenBase instance.

Functions are:

- isolated in worker threads
- executed inside a restricted VM context
- protected by an execution timeout
- prevented from running directly on the Fastify event loop

### Available runtime helpers

Functions receive a single context object.

```ts
export default async function handler({ openbase, db, storage, auth, params, request, log }) {
  const rows = await db.from('posts').select('*')
  log('Fetched posts', { count: rows.data?.length ?? 0 })
  return rows.data
}
```

Available fields:

- `openbase`
  an admin OpenBase SDK client for the current project
- `db`
  shorthand for `{ from, oql }`
- `storage`
  storage client from the admin SDK
- `auth`
  auth helpers, including `auth.admin`
- `params`
  RPC params or webhook request body
- `request`
  request metadata for webhook invocations
- `log(message, details?)`
  structured runtime log helper

The runtime also exposes `console.log`, `console.info`, `console.warn`, and `console.error`, which are captured into function logs.

### Supported triggers

#### RPC

```ts
const { data, error } = await client.rpc('published-posts', {
  status: 'published',
})
```

RPC access modes:

- `public`
- `authenticated`
- `service_role`

#### Webhook

Every function can expose a webhook endpoint:

```txt
POST /api/v1/:projectId/functions/:name/webhook
```

When a webhook secret is configured, send it through:

```txt
X-OpenBase-Function-Secret: your-secret
```

#### Cron

Cron schedules use five-field expressions:

```txt
*/15 * * * *
0 * * * *
30 9 * * 1-5
```

When a scheduled function is deployed, OpenBase calculates the next run, invokes it when due, and records the run in the function log stream.

### Dashboard management

The dashboard Functions page supports:

- create draft
- edit source/config
- deploy
- delete
- inspect invocation logs
- configure RPC access
- configure webhook method/secret
- configure cron schedule

### Admin SDK

Use the admin client for server-side management flows.

```ts
const admin = createAdminClient('http://localhost:3001', 'service-role-key')

await admin.admin.functions.save({
  name: 'published-posts',
  runtime: 'typescript',
  source: `
export default async function handler({ db }) {
  return db.from('posts').select('*')
}
  `,
  rpc: { enabled: true, access: 'authenticated' },
})

await admin.admin.functions.deploy('published-posts')
const logs = await admin.admin.functions.logs('published-posts')
```

Available methods:

- `admin.admin.functions.list()`
- `admin.admin.functions.get(name)`
- `admin.admin.functions.save(definition)`
- `admin.admin.functions.deploy(name)`
- `admin.admin.functions.logs(name)`
- `admin.admin.functions.delete(name)`

### Security notes

- Functions must be deployed before they can be invoked.
- Webhook endpoints can be protected with a shared secret.
- Worker timeouts terminate runaway executions.
- The VM context does not expose Node's general-purpose module loader to user code.
