export type FileRecord = {
  id: string;
  bucket: string;
  object_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  category: string;
  owner: string;
  tags: string[];
  validated: boolean;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  owner: string;
  created_at: string;
  updated_at: string;
};

export type ApiError = { error: string; code: string };
