# openbase-js

The official JavaScript/TypeScript client SDK for [OpenBase](https://github.com/openbase) — a Supabase-compatible backend powered by Telegram.

## Installation

```bash
npm install openbase-js
```

## Quick Start

```typescript
import { createClient } from 'openbase-js'

const openbase = createClient(
  'http://localhost:3001',  // Your OpenBase API URL
  'your-anon-key'          // Your project's anon key
)
```

## Database

### Query Rows

```typescript
// Select all rows
const { data, error } = await openbase
  .from('posts')
  .select('*')

// Select with filters
const { data } = await openbase
  .from('posts')
  .select('id, title, created_at')
  .eq('status', 'published')
  .order('created_at', { ascending: false })
  .limit(10)
```

### Insert Rows

```typescript
const { data, error } = await openbase
  .from('posts')
  .insert({ title: 'Hello World', body: 'My first post' })
```

### Update Rows

```typescript
const { data, error } = await openbase
  .from('posts')
  .update({ title: 'Updated Title' })
  .eq('id', 'some-uuid')
```

### Delete Rows

```typescript
const { data, error } = await openbase
  .from('posts')
  .delete()
  .eq('id', 'some-uuid')
```

### Row Count

```typescript
const { count } = await openbase
  .from('posts')
  .select('*', { count: 'exact', head: true })
```

## Authentication

### Sign Up

```typescript
const { data, error } = await openbase.auth.signUp({
  email: 'user@example.com',
  password: 'securepassword',
})

// data.user — the created user
// data.session — { access_token, refresh_token, expires_at }
```

### Sign In

```typescript
const { data, error } = await openbase.auth.signIn({
  email: 'user@example.com',
  password: 'securepassword',
})
```

### Sign Out

```typescript
await openbase.auth.signOut()
```

### Get Current User

```typescript
const { data: user } = await openbase.auth.getUser()
```

### Refresh Session

The SDK automatically refreshes the access token using the refresh token
when a request returns 401. You can also manually refresh:

```typescript
const { data: session } = await openbase.auth.refreshSession()
```

## Storage

### Upload File

```typescript
const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

const { data, error } = await openbase.storage
  .from('avatars')
  .upload('public/hello.txt', file)
```

### Download File

```typescript
const { data, error } = await openbase.storage
  .from('avatars')
  .download('public/hello.txt')
```

### Download with Image Transforms

```typescript
const { data } = await openbase.storage
  .from('avatars')
  .download('profile.png', {
    transform: { width: 200, height: 200, format: 'webp' },
  })
```

### Create Signed URL

```typescript
const { data, error } = await openbase.storage
  .from('avatars')
  .createSignedUrl('private/doc.pdf', 3600) // expires in 1 hour
```

### List Files

```typescript
const { data, error } = await openbase.storage
  .from('avatars')
  .list('public/')
```

### Delete File

```typescript
const { data, error } = await openbase.storage
  .from('avatars')
  .remove(['public/hello.txt'])
```

## Realtime

Subscribe to database changes in real-time via WebSockets:

```typescript
const subscription = openbase
  .channel('posts-changes')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'posts',
  }, (payload) => {
    console.log('New post:', payload.new)
  })
  .subscribe()
```

### Listen to All Events

```typescript
const subscription = openbase
  .channel('all-changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'posts',
  }, (payload) => {
    console.log(`${payload.eventType}:`, payload)
  })
  .subscribe()
```

### Unsubscribe

```typescript
subscription.unsubscribe()
```

## Environment Variables

When using the SDK in a frontend framework (Next.js, Vite, etc.):

```env
NEXT_PUBLIC_OPENBASE_URL=http://localhost:3001
NEXT_PUBLIC_OPENBASE_ANON_KEY=your-anon-key
```

```typescript
const openbase = createClient(
  process.env.NEXT_PUBLIC_OPENBASE_URL!,
  process.env.NEXT_PUBLIC_OPENBASE_ANON_KEY!
)
```

## License

MIT
