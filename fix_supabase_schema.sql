-- Additive migration for an existing MiniClassroom Supabase database.
-- Safe to run more than once; it preserves existing rows.

ALTER TABLE public.study_sessions
    ADD COLUMN IF NOT EXISTS exam_id BIGINT
    REFERENCES public.exams(id) ON DELETE SET NULL;

ALTER TABLE public.test_results
    ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT '';
