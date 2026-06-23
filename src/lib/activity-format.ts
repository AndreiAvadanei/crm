// Pure, client-safe helpers for rendering AuditLog activity entries.
// No server-only imports here so this can be used in client components too.

export type ActivityAction =
  // Deals
  | "deal_created"
  | "deal_updated"
  | "deal_stage_moved"
  | "deal_deleted"
  | "deal_shared"
  | "deal_unshared"
  // Tasks (logged against the parent Deal)
  | "task_created"
  | "task_updated"
  | "task_completed"
  | "task_reopened"
  | "task_deleted"
  // Comments (logged against the parent Deal)
  | "comment_added"
  | "comment_deleted"
  // Attachments (logged against the parent Deal)
  | "file_uploaded"
  | "file_deleted"
  // Clients
  | "client_created"
  | "client_updated"
  | "client_deleted"
  | "client_shared"
  | "client_unshared"
  // Admin: users
  | "user_created"
  | "user_updated"
  | "user_status_changed"
  | "user_password_reset"
  | "user_2fa_reset"
  | "access_rule_changed"
  // Admin: custom fields
  | "custom_field_created"
  | "custom_field_updated"
  | "custom_field_deleted"
  // Admin: stages
  | "stage_created"
  | "stage_updated"
  | "stage_deleted"
  | "stage_reordered"
  // Admin: tags
  | "tag_created"
  | "tag_updated"
  | "tag_deleted"
  // Auth
  | "user_logged_in"
  | "user_logged_out"
  | "password_changed"
  | "twofactor_enrolled"
  | "passkey_removed"
  // Branding
  | "branding_logo_updated"
  | "branding_logo_removed"
  // Admin: settings
  | "settings_updated";

type Meta = Record<string, unknown> | null | undefined;

/** A single pre-formatted field change stored in `meta.changes`. */
export type ActivityChange = { field: string; label: string; from: string; to: string };

function s(meta: Meta, key: string): string | undefined {
  const v = meta?.[key];
  return v == null || v === "" ? undefined : String(v);
}

function quote(v: string): string {
  return `\u2018${v}\u2019`;
}

/** Typed list of field changes stored in meta (empty if none / malformed). */
export function activityChanges(meta?: Meta): ActivityChange[] {
  const raw = meta?.["changes"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is ActivityChange =>
      !!c &&
      typeof c === "object" &&
      typeof (c as Record<string, unknown>).label === "string" &&
      typeof (c as Record<string, unknown>).from === "string" &&
      typeof (c as Record<string, unknown>).to === "string"
  );
}

function fieldsHint(meta?: Meta): string {
  const n = activityChanges(meta).length;
  return n ? ` (${n} ${n === 1 ? "field" : "fields"})` : "";
}

/** Best display name for the affected entity, if present in meta. */
export function activityEntityName(meta?: Meta): string | undefined {
  return (
    s(meta, "title") ??
    s(meta, "name") ??
    s(meta, "taskTitle") ??
    s(meta, "email") ??
    s(meta, "label") ??
    s(meta, "filename")
  );
}

/** Link target for the affected entity, or undefined when not linkable. */
export function activityEntityHref(
  entity: string,
  entityId: string | null | undefined,
  meta?: Meta
): string | undefined {
  const salesId = s(meta, "salesId");
  if (salesId) return `/deals/${salesId}`;
  if (entity === "Client" && entityId) return `/clients/${entityId}`;
  return undefined;
}

/**
 * Human-friendly verb phrase for an audit action (no actor name).
 * e.g. "added task ‘Call client’", "moved to stage Won".
 * Accepts unknown/legacy actions and falls back to a de-underscored label.
 */
export function activityPhrase(action: string, meta?: Meta): string {
  switch (action) {
    // Deals
    case "deal_created": {
      const title = s(meta, "title");
      const sales = s(meta, "salesId");
      return title ? `created deal ${quote(title)}${sales ? ` (${sales})` : ""}` : "created the deal";
    }
    case "deal_updated": {
      const title = s(meta, "title");
      const sales = s(meta, "salesId");
      const base = title ? `updated deal ${quote(title)}${sales ? ` (${sales})` : ""}` : "updated the deal";
      return `${base}${fieldsHint(meta)}`;
    }
    case "deal_stage_moved": {
      const stage = s(meta, "stageName");
      const title = s(meta, "title");
      const who = title ? `deal ${quote(title)}` : "the deal";
      return stage ? `moved ${who} to stage ${stage}` : `moved ${who} stage`;
    }
    case "deal_deleted": {
      const title = s(meta, "title");
      return title ? `deleted deal ${quote(title)}` : "deleted the deal";
    }
    case "deal_shared": {
      const who = s(meta, "userName");
      return who ? `shared the deal with ${who}` : "shared the deal";
    }
    case "deal_unshared": {
      const who = s(meta, "userName");
      return who ? `revoked ${who}'s access` : "unshared the deal";
    }
    // Tasks
    case "task_created": {
      const t = s(meta, "taskTitle");
      return t ? `added task ${quote(t)}` : "added a task";
    }
    case "task_updated": {
      const t = s(meta, "taskTitle");
      const base = t ? `updated task ${quote(t)}` : "updated a task";
      return `${base}${fieldsHint(meta)}`;
    }
    case "task_completed": {
      const t = s(meta, "taskTitle");
      return t ? `completed task ${quote(t)}` : "completed a task";
    }
    case "task_reopened": {
      const t = s(meta, "taskTitle");
      return t ? `reopened task ${quote(t)}` : "reopened a task";
    }
    case "task_deleted": {
      const t = s(meta, "taskTitle");
      return t ? `deleted task ${quote(t)}` : "deleted a task";
    }
    // Comments
    case "comment_added":
      return "added a comment";
    case "comment_deleted":
      return "deleted a comment";
    // Attachments
    case "file_uploaded": {
      const f = s(meta, "filename");
      return f ? `uploaded file ${quote(f)}` : "uploaded a file";
    }
    case "file_deleted": {
      const f = s(meta, "filename");
      return f ? `deleted file ${quote(f)}` : "deleted a file";
    }
    // Clients
    case "client_created": {
      const n = s(meta, "name");
      return n ? `created client ${quote(n)}` : "created a client";
    }
    case "client_updated": {
      const n = s(meta, "name");
      const base = n ? `updated client ${quote(n)}` : "updated the client";
      return `${base}${fieldsHint(meta)}`;
    }
    case "client_deleted": {
      const n = s(meta, "name");
      return n ? `deleted client ${quote(n)}` : "deleted a client";
    }
    case "client_shared": {
      const who = s(meta, "userName");
      const n = s(meta, "name");
      const what = n ? `client ${quote(n)}` : "the client";
      return who ? `shared ${what} with ${who}` : `shared ${what}`;
    }
    case "client_unshared": {
      const who = s(meta, "userName");
      const n = s(meta, "name");
      const what = n ? `client ${quote(n)}` : "the client";
      return who ? `revoked ${who}'s access to ${what}` : `unshared ${what}`;
    }
    // Admin: users
    case "user_created": {
      const e = s(meta, "email");
      return e ? `created user ${e}` : "created a user";
    }
    case "user_updated": {
      const n = s(meta, "name");
      const base = n ? `updated user ${n}` : "updated a user";
      return `${base}${fieldsHint(meta)}`;
    }
    case "user_status_changed": {
      const st = s(meta, "status");
      return st ? `set user status to ${st.toLowerCase()}` : "changed a user's status";
    }
    case "user_password_reset":
      return "reset a user's password";
    case "user_2fa_reset":
      return "reset a user's 2FA";
    case "access_rule_changed":
      return "updated access rules";
    // Admin: custom fields
    case "custom_field_created": {
      const l = s(meta, "label");
      return l ? `created custom field ${quote(l)}` : "created a custom field";
    }
    case "custom_field_updated": {
      const l = s(meta, "label");
      const base = l ? `updated custom field ${quote(l)}` : "updated a custom field";
      return `${base}${fieldsHint(meta)}`;
    }
    case "custom_field_deleted":
      return "deleted a custom field";
    // Admin: stages
    case "stage_created": {
      const n = s(meta, "name");
      return n ? `created stage ${quote(n)}` : "created a stage";
    }
    case "stage_updated": {
      const n = s(meta, "name");
      const base = n ? `updated stage ${quote(n)}` : "updated a stage";
      return `${base}${fieldsHint(meta)}`;
    }
    case "stage_deleted":
      return "deleted a stage";
    case "stage_reordered":
      return "reordered stages";
    // Admin: tags
    case "tag_created": {
      const n = s(meta, "name");
      return n ? `created tag ${quote(n)}` : "created a tag";
    }
    case "tag_updated": {
      const n = s(meta, "name");
      const base = n ? `updated tag ${quote(n)}` : "updated a tag";
      return `${base}${fieldsHint(meta)}`;
    }
    case "tag_deleted":
      return "deleted a tag";
    // Auth
    case "user_logged_in":
    case "login": // legacy
      return "logged in";
    case "user_logged_out":
      return "logged out";
    case "password_changed":
      return "changed their password";
    case "twofactor_enrolled": {
      const m = s(meta, "method");
      return m ? `enrolled 2FA (${m})` : "enrolled 2FA";
    }
    case "2fa_enrolled_totp": // legacy
      return "enrolled 2FA (totp)";
    case "2fa_enrolled_passkey": // legacy
      return "enrolled 2FA (passkey)";
    case "passkey_removed":
      return "removed a passkey";
    // Branding
    case "branding_logo_updated": {
      const m = s(meta, "mode");
      return m ? `updated the ${m} mode logo` : "updated the logo";
    }
    case "branding_logo_removed": {
      const m = s(meta, "mode");
      return m ? `removed the ${m} mode logo` : "removed the logo";
    }
    default:
      return action.replace(/_/g, " ");
  }
}

/** Full sentence: "Jane Doe added task ‘Call client’". */
export function formatActivity(action: string, meta: Meta, actorName: string | null | undefined): string {
  return `${actorName ?? "System"} ${activityPhrase(action, meta)}`;
}
