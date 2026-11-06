begin;

alter table public.docs_members
  add column if not exists avatar_data text
  check (
    avatar_data is null
    or (
      octet_length(avatar_data) <= 140000
      and avatar_data ~ '^data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+$'
    )
  );

comment on column public.docs_members.avatar_data is
  'Small Microsoft profile photo cached for the member, visible under the existing member row access policy.';

commit;
