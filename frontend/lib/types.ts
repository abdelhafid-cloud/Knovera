export type ApiErrorBody = {
  message?: string;
  code?: string;
  details?: unknown;
};

export type ApiResponse<T = unknown> = {
  success: boolean;
  data: T;
  error: ApiErrorBody | null;
  meta?: {
    page?: number;
    per_page?: number;
    total?: number;
  } | null;
};

export type Membership = {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  organization_slug?: string | null;
  organization_status?: string | null;
  organization_logo_url?: string | null;
  role?: {
    id: string;
    code: string | null;
    name: string | null;
  };
  permissions?: string[];
  status: string;
};

export type User = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  avatar_url?: string | null;
  is_active?: boolean;
  is_super_admin?: boolean;
  last_login_at?: string | null;
  created_at?: string | null;
  memberships?: Membership[];
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  status: string;
  settings?: Record<string, unknown>;
  is_super_admin_workspace?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  members_count?: number;
  documents_count?: number;
  assistants_count?: number;
  conversations_count?: number;
  quotas?: OrgQuotas;
  usage?: OrgUsage;
  items?: QuotaItem[];
};

export type OrgQuotas = {
  max_members: number;
  max_documents: number;
  max_assistants: number;
  max_knowledge_bases: number;
  max_storage_bytes: number;
};

export type OrgUsage = {
  members: number;
  documents: number;
  assistants: number;
  knowledge_bases: number;
  storage_bytes: number;
};

export type QuotaItem = {
  key: string;
  quota_key: string;
  label: string;
  used: number;
  limit: number;
  percent: number;
  over: boolean;
  warning: boolean;
};

export type PlatformAlert = {
  id: string;
  severity: "danger" | "warning" | "info";
  title: string;
  description?: string;
  href?: string;
};

export type DocumentItem = {
  id: string;
  organization_id: string;
  knowledge_base_id?: string | null;
  uploaded_by?: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  error_message?: string | null;
  page_count?: number | null;
  cloud_url?: string | null;
  source_url?: string | null;
  indexed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  bucket?: string | null;
  storage_key?: string | null;
  file_name?: string | null;
  minio_object_path?: string | null;
  minio_console_hint?: string | null;
  minio_url?: string | null;
  organization_name?: string | null;
};

export type KnowledgeBase = {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  rag_settings?: Record<string, unknown>;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  document_count?: number | null;
};

export type Assistant = {
  id: string;
  organization_id: string;
  knowledge_base_id: string;
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  model?: string;
  temperature?: number;
  top_k?: number;
  welcome_message?: string | null;
  is_active?: boolean;
  system_prompt?: string;
  rag_settings?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MessageSource = {
  id: string;
  document_id?: string | null;
  chunk_id?: string | null;
  page_number?: number | null;
  relevance_score?: number | null;
  excerpt?: string | null;
  document_name?: string | null;
  minio_url?: string | null;
};

export type Message = {
  id: string;
  conversation_id?: string;
  role: "user" | "assistant" | "system" | string;
  content: string;
  created_at?: string | null;
  sources?: MessageSource[];
};

export type Conversation = {
  id: string;
  organization_id: string;
  assistant_id: string;
  user_id: string;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
  messages?: Message[];
};

export type LoginResult = {
  access_token: string;
  user: User;
};

export type MeResult = {
  user: User;
  current_organization: Organization | null;
  permissions: string[];
  is_super_admin: boolean;
};
