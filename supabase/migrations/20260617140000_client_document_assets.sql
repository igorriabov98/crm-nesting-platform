alter table clients
  add column if not exists signature_image_path text,
  add column if not exists stamp_image_path text;
