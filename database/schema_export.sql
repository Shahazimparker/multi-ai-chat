


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."insert_rag_document"("p_user_id" "uuid", "p_topic_id" "uuid", "p_file_name" "text", "p_file_hash" "text", "p_file_type" "text", "p_original_content" "text", "p_llm_analysis" "text", "p_embedding" "public"."vector") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  INSERT INTO uploaded_files_rag (user_id, topic_id, file_name, file_hash, file_type, original_content, llm_analysis, embedding)
  VALUES (p_user_id, p_topic_id, p_file_name, p_file_hash, p_file_type, p_original_content, p_llm_analysis, p_embedding)
  RETURNING uploaded_files_rag.id;
END;
$$;


ALTER FUNCTION "public"."insert_rag_document"("p_user_id" "uuid", "p_topic_id" "uuid", "p_file_name" "text", "p_file_hash" "text", "p_file_type" "text", "p_original_content" "text", "p_llm_analysis" "text", "p_embedding" "public"."vector") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_threshold" double precision DEFAULT 0.4, "match_count" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    rag_documents.id,
    rag_documents.title,
    rag_documents.content,
    1 - (rag_documents.embedding <=> query_embedding) AS similarity
  FROM rag_documents
  WHERE 1 - (rag_documents.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_query_cache"("query_embedding" "public"."vector", "model_param" "text", "match_threshold" double precision DEFAULT 0.92, "match_count" integer DEFAULT 1, "user_id_param" "uuid" DEFAULT NULL::"uuid", "topic_id_param" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "query_text" "text", "response_text" "text", "hit_count" integer, "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    query_cache.id,
    query_cache.query_text,
    query_cache.response_text,
    query_cache.hit_count,
    1 - (query_cache.query_embedding <=> query_embedding) AS similarity
  FROM query_cache
  WHERE query_cache.model = model_param
    AND query_cache.query_embedding IS NOT NULL
    AND query_cache.user_id IS NOT DISTINCT FROM user_id_param
    AND query_cache.topic_id IS NOT DISTINCT FROM topic_id_param
    AND 1 - (query_cache.query_embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_query_cache"("query_embedding" "public"."vector", "model_param" "text", "match_threshold" double precision, "match_count" integer, "user_id_param" "uuid", "topic_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_topic_files"("query_embedding" "public"."vector", "p_topic_id" "uuid", "match_threshold" double precision DEFAULT 0.4, "match_count" integer DEFAULT 3) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    uf.id,
    uf.file_name AS title,
    COALESCE(uf.llm_analysis, uf.original_content) AS content,
    1 - (uf.embedding <=> query_embedding) AS similarity
  FROM uploaded_files_rag uf
  WHERE uf.topic_id = p_topic_id
    AND uf.embedding IS NOT NULL
    AND 1 - (uf.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_topic_files"("query_embedding" "public"."vector", "p_topic_id" "uuid", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_uploaded_files"("query_embedding" "public"."vector", "user_id_param" "uuid", "provider_param" "text", "match_count" integer DEFAULT 5, "topic_id_param" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("file_id" "uuid", "file_name" "text", "chunk_text" "text", "chunk_index" integer, "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id, f.file_name, c.chunk_text, c.chunk_index, 
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM rag_chunks c
  JOIN uploaded_files f ON c.file_id = f.id
  WHERE f.user_id = user_id_param
    AND (topic_id_param IS NULL OR f.topic_id = topic_id_param)
    AND c.provider = provider_param
    AND 1 - (c.embedding <=> query_embedding) > 0.4
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."search_uploaded_files"("query_embedding" "public"."vector", "user_id_param" "uuid", "provider_param" "text", "match_count" integer, "topic_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_user_memories"("query_embedding" "public"."vector", "user_id_param" "uuid", "match_threshold" double precision DEFAULT 0.5, "match_count" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "memory_text" "text", "category" "text", "confidence" double precision, "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.memory_text,
    m.category,
    m.confidence,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM user_memories m
  WHERE m.user_id = user_id_param
    AND m.topic_id IS NULL
    AND m.category = 'fact'
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."search_user_memories"("query_embedding" "public"."vector", "user_id_param" "uuid", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chat_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "request" "jsonb" NOT NULL,
    "result" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "partial_reply" "text"
);


ALTER TABLE "public"."chat_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."code_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "topic_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_type" "text",
    "content" "text",
    "language" "text",
    "file_hash" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "rag_record_id" "uuid"
);


ALTER TABLE "public"."code_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."file_rag" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "topic_id" "uuid",
    "file_name" character varying NOT NULL,
    "chunk_text" "text" NOT NULL,
    "embeddings" "public"."vector"(1536),
    "hash" character varying,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."file_rag" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic_id" "uuid",
    "user_id" "uuid",
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "model" "text",
    "tokens_used" integer DEFAULT 0,
    "is_summary" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."query_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "query_text" "text" NOT NULL,
    "model" "text" NOT NULL,
    "tokens_used" integer DEFAULT 0,
    "is_anonymous" boolean DEFAULT false,
    "cache_hit" boolean DEFAULT false,
    "response_time_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."query_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."query_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "query_hash" "text" NOT NULL,
    "query_text" "text" NOT NULL,
    "response_text" "text" NOT NULL,
    "model" "text" NOT NULL,
    "hit_count" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_hit_at" timestamp with time zone DEFAULT "now"(),
    "query_embedding" "public"."vector"(1536),
    "user_id" "uuid",
    "topic_id" "uuid"
);


ALTER TABLE "public"."query_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rag_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid",
    "chunk_text" "text" NOT NULL,
    "provider" "text" DEFAULT 'openai'::"text",
    "embedding" "public"."vector"(1536),
    "chunk_index" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rag_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rag_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "embedding" "public"."vector"(768),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "provider" "text" DEFAULT 'openai'::"text"
);


ALTER TABLE "public"."rag_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" DEFAULT 'New Chat'::"text" NOT NULL,
    "model" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uploaded_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "topic_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_type" "text",
    "file_size" integer,
    "content_text" "text",
    "provider" "text" DEFAULT 'openai'::"text",
    "embedding" "public"."vector"(1536),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."uploaded_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uploaded_files_rag" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "topic_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "original_content" "text",
    "original_file_data" "bytea",
    "llm_analysis" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "file_hash" "text",
    "embedding" "public"."vector"(1536)
);


ALTER TABLE "public"."uploaded_files_rag" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_memories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "topic_id" "uuid",
    "memory_text" "text" NOT NULL,
    "embedding" "public"."vector"(1536),
    "category" "text" DEFAULT 'fact'::"text" NOT NULL,
    "confidence" double precision DEFAULT 0.7,
    "access_count" integer DEFAULT 0,
    "last_accessed_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_memories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "username" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "total_tokens" integer DEFAULT 100000,
    "used_tokens" integer DEFAULT 0,
    "per_query_limit" integer DEFAULT 2000,
    "session_minutes" integer DEFAULT 60,
    "locked_until" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."chat_jobs"
    ADD CONSTRAINT "chat_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."code_files"
    ADD CONSTRAINT "code_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_rag"
    ADD CONSTRAINT "file_rag_hash_key" UNIQUE ("hash");



ALTER TABLE ONLY "public"."file_rag"
    ADD CONSTRAINT "file_rag_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."query_analytics"
    ADD CONSTRAINT "query_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."query_cache"
    ADD CONSTRAINT "query_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."query_cache"
    ADD CONSTRAINT "query_cache_query_hash_key" UNIQUE ("query_hash");



ALTER TABLE ONLY "public"."rag_chunks"
    ADD CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rag_documents"
    ADD CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uploaded_files"
    ADD CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uploaded_files_rag"
    ADD CONSTRAINT "uploaded_files_rag_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_memories"
    ADD CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_username_key" UNIQUE ("username");



CREATE INDEX "idx_code_files_topic" ON "public"."code_files" USING "btree" ("topic_id");



CREATE INDEX "idx_code_files_user" ON "public"."code_files" USING "btree" ("user_id");



CREATE INDEX "idx_file_hash" ON "public"."uploaded_files_rag" USING "btree" ("file_hash");



CREATE INDEX "idx_file_rag_hash" ON "public"."file_rag" USING "btree" ("hash");



CREATE INDEX "idx_file_rag_user_topic" ON "public"."file_rag" USING "btree" ("user_id", "topic_id");



CREATE INDEX "idx_uploaded_files_rag_created" ON "public"."uploaded_files_rag" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_uploaded_files_rag_file_name" ON "public"."uploaded_files_rag" USING "btree" ("file_name");



CREATE INDEX "idx_uploaded_files_rag_fts" ON "public"."uploaded_files_rag" USING "gin" ("to_tsvector"('"english"'::"regconfig", (("file_name" || ' '::"text") || "llm_analysis")));



CREATE INDEX "idx_uploaded_files_rag_topic_id" ON "public"."uploaded_files_rag" USING "btree" ("topic_id");



CREATE INDEX "idx_uploaded_files_rag_user_id" ON "public"."uploaded_files_rag" USING "btree" ("user_id");



CREATE INDEX "query_cache_embedding_idx" ON "public"."query_cache" USING "ivfflat" ("query_embedding" "public"."vector_cosine_ops") WHERE ("query_embedding" IS NOT NULL);



CREATE INDEX "uploaded_files_rag_embedding_idx" ON "public"."uploaded_files_rag" USING "ivfflat" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "user_memories_embedding_idx" ON "public"."user_memories" USING "ivfflat" ("embedding" "public"."vector_cosine_ops") WHERE ("embedding" IS NOT NULL);



CREATE INDEX "user_memories_topic_idx" ON "public"."user_memories" USING "btree" ("topic_id");



CREATE INDEX "user_memories_user_idx" ON "public"."user_memories" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "topics_updated_at" BEFORE UPDATE ON "public"."topics" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."chat_jobs"
    ADD CONSTRAINT "chat_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."code_files"
    ADD CONSTRAINT "code_files_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."code_files"
    ADD CONSTRAINT "code_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_rag"
    ADD CONSTRAINT "file_rag_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_rag"
    ADD CONSTRAINT "file_rag_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."query_analytics"
    ADD CONSTRAINT "query_analytics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."query_cache"
    ADD CONSTRAINT "query_cache_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."query_cache"
    ADD CONSTRAINT "query_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rag_chunks"
    ADD CONSTRAINT "rag_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."uploaded_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uploaded_files_rag"
    ADD CONSTRAINT "uploaded_files_rag_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uploaded_files_rag"
    ADD CONSTRAINT "uploaded_files_rag_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uploaded_files"
    ADD CONSTRAINT "uploaded_files_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."uploaded_files"
    ADD CONSTRAINT "uploaded_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_memories"
    ADD CONSTRAINT "user_memories_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_memories"
    ADD CONSTRAINT "user_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can delete own files" ON "public"."uploaded_files_rag" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert own files" ON "public"."uploaded_files_rag" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own files" ON "public"."uploaded_files_rag" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."uploaded_files_rag" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_rag_document"("p_user_id" "uuid", "p_topic_id" "uuid", "p_file_name" "text", "p_file_hash" "text", "p_file_type" "text", "p_original_content" "text", "p_llm_analysis" "text", "p_embedding" "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_rag_document"("p_user_id" "uuid", "p_topic_id" "uuid", "p_file_name" "text", "p_file_hash" "text", "p_file_type" "text", "p_original_content" "text", "p_llm_analysis" "text", "p_embedding" "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_rag_document"("p_user_id" "uuid", "p_topic_id" "uuid", "p_file_name" "text", "p_file_hash" "text", "p_file_type" "text", "p_original_content" "text", "p_llm_analysis" "text", "p_embedding" "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_documents"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."match_query_cache"("query_embedding" "public"."vector", "model_param" "text", "match_threshold" double precision, "match_count" integer, "user_id_param" "uuid", "topic_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."match_query_cache"("query_embedding" "public"."vector", "model_param" "text", "match_threshold" double precision, "match_count" integer, "user_id_param" "uuid", "topic_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_query_cache"("query_embedding" "public"."vector", "model_param" "text", "match_threshold" double precision, "match_count" integer, "user_id_param" "uuid", "topic_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_topic_files"("query_embedding" "public"."vector", "p_topic_id" "uuid", "match_threshold" double precision, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_topic_files"("query_embedding" "public"."vector", "p_topic_id" "uuid", "match_threshold" double precision, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_topic_files"("query_embedding" "public"."vector", "p_topic_id" "uuid", "match_threshold" double precision, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_uploaded_files"("query_embedding" "public"."vector", "user_id_param" "uuid", "provider_param" "text", "match_count" integer, "topic_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."search_uploaded_files"("query_embedding" "public"."vector", "user_id_param" "uuid", "provider_param" "text", "match_count" integer, "topic_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_uploaded_files"("query_embedding" "public"."vector", "user_id_param" "uuid", "provider_param" "text", "match_count" integer, "topic_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_user_memories"("query_embedding" "public"."vector", "user_id_param" "uuid", "match_threshold" double precision, "match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_user_memories"("query_embedding" "public"."vector", "user_id_param" "uuid", "match_threshold" double precision, "match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_user_memories"("query_embedding" "public"."vector", "user_id_param" "uuid", "match_threshold" double precision, "match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."chat_jobs" TO "anon";
GRANT ALL ON TABLE "public"."chat_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."code_files" TO "anon";
GRANT ALL ON TABLE "public"."code_files" TO "authenticated";
GRANT ALL ON TABLE "public"."code_files" TO "service_role";



GRANT ALL ON TABLE "public"."file_rag" TO "anon";
GRANT ALL ON TABLE "public"."file_rag" TO "authenticated";
GRANT ALL ON TABLE "public"."file_rag" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."query_analytics" TO "anon";
GRANT ALL ON TABLE "public"."query_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."query_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."query_cache" TO "anon";
GRANT ALL ON TABLE "public"."query_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."query_cache" TO "service_role";



GRANT ALL ON TABLE "public"."rag_chunks" TO "anon";
GRANT ALL ON TABLE "public"."rag_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."rag_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."rag_documents" TO "anon";
GRANT ALL ON TABLE "public"."rag_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."rag_documents" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."topics" TO "anon";
GRANT ALL ON TABLE "public"."topics" TO "authenticated";
GRANT ALL ON TABLE "public"."topics" TO "service_role";



GRANT ALL ON TABLE "public"."uploaded_files" TO "anon";
GRANT ALL ON TABLE "public"."uploaded_files" TO "authenticated";
GRANT ALL ON TABLE "public"."uploaded_files" TO "service_role";



GRANT ALL ON TABLE "public"."uploaded_files_rag" TO "anon";
GRANT ALL ON TABLE "public"."uploaded_files_rag" TO "authenticated";
GRANT ALL ON TABLE "public"."uploaded_files_rag" TO "service_role";



GRANT ALL ON TABLE "public"."user_memories" TO "anon";
GRANT ALL ON TABLE "public"."user_memories" TO "authenticated";
GRANT ALL ON TABLE "public"."user_memories" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







