-- Backlog Studio: schema del database (idempotente, si può rieseguire)

create table if not exists users (
  account_id    text primary key,          -- account Atlassian
  name          text,
  email         text,
  picture       text,
  access_token  text,                      -- cifrato con TOKEN_KEY
  refresh_token text,                      -- cifrato con TOKEN_KEY
  expires_at    timestamptz,
  sites         jsonb not null default '[]'::jsonb,  -- siti Atlassian accessibili
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists sessions (
  id_hash     text primary key,            -- sha256 dell'id nel cookie
  account_id  text not null references users(account_id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_account on sessions(account_id);

create table if not exists projects (
  id          text primary key,
  name        text not null,
  cloud_id    text not null,               -- sito Atlassian: chi vi accede vede il progetto
  site_url    text,
  created_by  text references users(account_id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_cloud on projects(cloud_id);

-- Documenti del progetto: meta (project, kit, jira, chat), docs, reqs, questions, tickets, decisions
create table if not exists items (
  project_id  text not null references projects(id) on delete cascade,
  col         text not null,
  id          text not null,
  data        jsonb not null,
  deleted     boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default clock_timestamp(),
  primary key (project_id, col, id)
);
create index if not exists items_sync on items(project_id, updated_at);

-- Dati personali (Atlassian Personal Data Reporting API)
-- data_updated_at: quando abbiamo letto nome ed email da Atlassian; reported_at: ultima segnalazione ad Atlassian
alter table users add column if not exists data_updated_at timestamptz;
alter table users add column if not exists reported_at timestamptz;
create table if not exists app_settings (
  key   text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
