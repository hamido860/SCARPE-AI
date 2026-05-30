-- Supabase Schema Guide
-- This file logs the full Supabase schema to serve as a unique guide for Gemma 4 and the application.

create table public.rag_chunks (
  id uuid not null default gen_random_uuid (),
  content text not null,
  embedding public.vector null,
  source_type text null,
  source_id uuid null,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  constraint rag_chunks_pkey primary key (id),
  constraint rag_chunks_source_type_check check (
    (
      source_type = any (
        array[
          'lesson_block'::text,
          'exercise'::text,
          'exam'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists rag_chunks_embedding_idx on public.rag_chunks using hnsw (embedding vector_cosine_ops) TABLESPACE pg_default;
