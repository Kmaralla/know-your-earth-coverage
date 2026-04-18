# Know Your Earth Coverage (MVP C)

Next.js + Supabase MVP implementing:

- searchable public profile shell (`display_name`, `handle`, `description`)
- directed map sharing (`sender -> receiver` once accepted)
- world tab + country tab with map markers and save/visualize flow
- incoming share request inbox (accept/reject)

## Directed Sharing Rule

If `A` sends request to `B` and `B` accepts, then:

- `B` can see `A` maps
- `A` still cannot see `B` maps unless `B` also shares back

This is enforced by RLS in `supabase/schema.sql`.

## Setup

1. Create a Supabase project.
2. Run SQL from `supabase/schema.sql` in Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and fill values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Auth uses email magic link.
- For the country tab demo dataset, this MVP currently includes India and United States subdivisions/cities.
- World coverage markers currently use a curated country list in `lib/geo.ts` for MVP speed.
