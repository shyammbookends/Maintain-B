-- Only three roles remain: Super Admin, Admin and User (system key WORKER).
-- Everyone on another role (Maintenance Manager, Supervisor, Requester or a
-- custom role) moves to Admin when that role opened the admin app, otherwise
-- to User. Those roles are then removed.

-- 1. Sign the moved people out so their new access applies at once.
UPDATE "users" SET "token_version" = "token_version" + 1
WHERE "id" IN (
  SELECT ur."user_id"
  FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."role_id"
  WHERE r."system_key" IS NULL OR r."system_key" NOT IN ('SUPER_ADMIN', 'ADMIN', 'WORKER')
);

-- 2. Give them the matching role.
INSERT INTO "user_roles" ("user_id", "role_id")
SELECT DISTINCT ur."user_id", target."id"
FROM "user_roles" ur
JOIN "roles" r ON r."id" = ur."role_id"
JOIN "roles" target
  ON target."organization_id" = r."organization_id"
 AND target."system_key" = CASE WHEN r."kind" = 'ADMIN' THEN 'ADMIN' ELSE 'WORKER' END
WHERE r."system_key" IS NULL OR r."system_key" NOT IN ('SUPER_ADMIN', 'ADMIN', 'WORKER')
ON CONFLICT DO NOTHING;

-- 3. Remove the old roles (their user and permission links cascade).
DELETE FROM "roles"
WHERE "system_key" IS NULL OR "system_key" NOT IN ('SUPER_ADMIN', 'ADMIN', 'WORKER');

-- 4. The worker role is now called "User".
UPDATE "roles"
SET "name" = 'User', "description" = 'Does assigned work, runs checklists and reports problems.'
WHERE "system_key" = 'WORKER';
