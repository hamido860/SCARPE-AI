-- Supabase Schema for Scraped Metadata
-- To use this, run these commands in your Supabase SQL Editor

-- Enable the pgvector extension to work with embeddings if needed
create extension if not exists vector;

-- Table to store the main scraping sessions/runs
create table if not exists scrape_sessions (
    id uuid default gen_random_uuid() primary key,
    target_url text not null,
    started_at timestamp with time zone default timezone('utc'::text, now()) not null,
    status text default 'in_progress', -- 'in_progress', 'completed', 'failed'
    metadata jsonb default '{}'::jsonb
);

-- Main table for scraped pages and documents
create table if not exists scraped_content (
    id uuid default gen_random_uuid() primary key,
    session_id uuid references scrape_sessions(id) on delete set null,
    url text not null unique,
    domain text not null,
    title text,
    description text,
    raw_text text,
    is_pdf boolean default false,
    
    -- Educational Metadata (specific to Moutamadris & general education)
    grade_level text,     -- e.g., 'Primary', 'Middle School', 'High School / Bac', 'Common Core'
    subject text,         -- e.g., 'Math', 'Physics', 'French'
    content_type text,    -- e.g., 'Course', 'Exercise', 'Summary'
    
    -- AI Analysis Output
    ai_summary text,
    ai_sentiment text,
    detected_country text,
    detected_languages text[],
    
    -- Tracking
    scraped_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create an index to quickly find content by URL
create index scraped_content_url_idx on scraped_content (url);

-- Create an index for educational filtering
create index scraped_content_grade_subject_idx on scraped_content (grade_level, subject);

-- Table to store individual links found on pages
create table if not exists extracted_links (
    id uuid default gen_random_uuid() primary key,
    source_url text not null references scraped_content(url) on delete cascade,
    target_url text not null,
    link_text text,
    is_internal boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table for vector embeddings (if you want to do semantic search over the scraped data later)
create table if not exists content_embeddings (
    id uuid default gen_random_uuid() primary key,
    content_id uuid references scraped_content(id) on delete cascade,
    chunk_text text not null,
    embedding vector(768), -- Dimension size depends on your embedding model
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Function to automatically update the updated_at timestamp
create or replace function update_modified_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

create trigger update_scraped_content_modtime
    before update on scraped_content
    for each row
    execute function update_modified_column();

-- Setup Row Level Security (RLS)
alter table scrape_sessions enable row level security;
alter table scraped_content enable row level security;
alter table extracted_links enable row level security;
alter table content_embeddings enable row level security;

-- Create policies for service role access (Server-side actions)
create policy "Enable all access for service role on scrape_sessions" on scrape_sessions for all using (true) with check (true);
create policy "Enable all access for service role on scraped_content" on scraped_content for all using (true) with check (true);
create policy "Enable all access for service role on extracted_links" on extracted_links for all using (true) with check (true);
create policy "Enable all access for service role on content_embeddings" on content_embeddings for all using (true) with check (true);

-- Dictionaries for reference classification (Read-only reference)
create table if not exists classification_dictionary (
    id text primary key, -- e.g. "active_dictionary"
    data jsonb not null default '{}'::jsonb,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS and insert policies
alter table classification_dictionary enable row level security;
create policy "Enable all access for service role on classification_dictionary" on classification_dictionary for all using (true) with check (true);
create policy "Enable read access for all on classification_dictionary" on classification_dictionary for select using (true);

-- ==========================================
-- Schema for Workflow PDF Documents & Storage Logs
-- ==========================================

-- Table to store custom tracked PDF documents in the extraction workflow pipeline
create table if not exists public.pdf_documents (
    hash text primary key,
    url text not null,
    file_name text not null,
    drive_file_id text,
    drive_url text,
    storage_status text default 'not_started',    -- 'not_started', 'saved_to_drive'
    processing_status text default 'not_started', -- 'not_started', 'in_progress', 'completed', 'failed'
    review_status text default 'not_reviewed',     -- 'not_reviewed', 'auto_approved', 'needs_metadata_review'
    created_at timestamp with time zone default timezone('utc'::text, now()),
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Table to log Drive uploads specifically
create table if not exists public.pdf_drive_files (
    id uuid default gen_random_uuid() primary key,
    source_url text,
    drive_file_id text,
    drive_view_url text,
    file_name text,
    mime_type text,
    file_size bigint,
    status text,
    error_message text,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Setup Row Level Security (RLS) for the new tables
alter table public.pdf_documents enable row level security;
alter table public.pdf_drive_files enable row level security;

-- Create service role policies (server-side actions)
create policy "Enable all access for service role on pdf_documents" on public.pdf_documents for all using (true) with check (true);
create policy "Enable all access for service role on pdf_drive_files" on public.pdf_drive_files for all using (true) with check (true);
create policy "Enable read-only access for authenticated/anon on pdf_documents" on public.pdf_documents for select using (true);
create policy "Enable read-only access for authenticated/anon on pdf_drive_files" on public.pdf_drive_files for select using (true);

