# Student Notes

An offline-first student notes app with Supabase sync, realtime updates, rich-text editing, responsive design, and PWA support.

## Features

- Organize notes by student
- Rich-text note editor and reading mode
- Offline local storage with queued synchronization
- Supabase Auth, Row Level Security, and Realtime sync
- Responsive light and dark themes
- Installable Progressive Web App

## Run locally

Serve the directory with any static HTTP server, then open it in a browser. For example:

```sh
python -m http.server 4173
```

Open `http://127.0.0.1:4173/`.

## Supabase setup

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
3. Copy `config.example.js` to `config.js` and add the project URL and publishable key.
4. Enable Anonymous Sign-Ins if using the automatic single-user flow.

Only use a Supabase publishable key in this frontend. Never include a secret or service-role key.

