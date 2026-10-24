import assert from "node:assert/strict";
import test from "node:test";
import { createAccount, deleteAccount, resetPassword } from "../supabase/functions/_shared/accountWorkflows.ts";

const baseAccount = {
  studentId: "20231001", name: "张三", department: "宣传部", phone: "13812345678",
  role: "member", email: "", position: "", notes: "",
};
const targetUser = { id: 5, student_id: "20231002", name: "李四", role: "member", is_active: true, auth_user_id: "auth-9" };

// Stub of the Supabase service client: records every audit insert/update and Auth
// call with a global sequence so tests can assert the intent is written before the
// side effect, and can script failures per table/call.
function makeAdminDb(options = {}) {
  const cfg = {
    selectSingle: null,
    selectError: null,
    departmentUpsert: { data: { id: 11 }, error: null },
    createUser: { data: { user: { id: "auth-1" } }, error: null },
    profileUpdate: { data: { id: 33 }, error: null },
    logInsert: { data: { id: 101 }, error: null },
    logUpdate: { error: null },
    counts: {},
    deleteUser: { error: null },
    updateUserById: { error: null },
    usersUpdate: { error: null },
    ...options,
  };
  const state = { seq: 0, logInserts: [], logUpdates: [], authCalls: [] };
  const mark = (store, payload) => {
    const entry = { seq: ++state.seq, ...payload };
    store.push(entry);
    return entry;
  };
  const eq = (resolved) => {
    const p = Promise.resolve(resolved);
    return Object.assign(p, {
      eq: () => eq(resolved),
      maybeSingle: () => Promise.resolve(resolved.single ?? { data: null, error: null }),
      single: () => Promise.resolve(resolved.single ?? { data: null, error: null }),
      select: () => ({
        eq: () => eq(resolved),
        single: () => Promise.resolve(resolved.single ?? { data: null, error: null }),
        maybeSingle: () => Promise.resolve(resolved.single ?? { data: null, error: null }),
      }),
    });
  };
  const resolveSelect = (table, cols, opts) => {
    if (cfg.resolveSelect) return cfg.resolveSelect(table, cols, opts);
    if (opts?.count != null) return { error: cfg.counts[table]?.error ?? null, count: cfg.counts[table]?.count ?? 0 };
    return { single: cfg.selectSingle, error: cfg.selectError ?? null };
  };
  return {
    state,
    from: (table) => ({
      select: (cols, opts) => eq(resolveSelect(table, cols, opts)),
      insert: (row) => {
        mark(state.logInserts, { table, row });
        return { select: () => ({ single: () => Promise.resolve(cfg.logInsert) }) };
      },
      update: (row) => {
        mark(table === "operation_logs" ? state.logUpdates : state.logUpdates, { table, row });
        const resolved = table === "operation_logs"
          ? { error: cfg.logUpdate.error }
          : { single: cfg.profileUpdate, error: cfg.usersUpdate.error ?? null };
        return eq(resolved);
      },
      upsert: (row) => ({ select: () => ({ single: () => Promise.resolve(cfg.departmentUpsert) }) }),
      delete: () => eq({ single: null, error: cfg.usersDelete.error ?? null, count: 0 }),
    }),
    auth: { admin: {
      createUser: async (attributes) => {
        mark(state.authCalls, { fn: "createUser", attributes });
        return cfg.createUser;
      },
      deleteUser: async (id) => {
        mark(state.authCalls, { fn: "deleteUser", id });
        return cfg.deleteUser;
      },
      updateUserById: async (id, attributes) => {
        mark(state.authCalls, { fn: "updateUserById", id });
        return cfg.updateUserById;
      },
    } },
  };
}

const auditIntents = (db) => db.state.logInserts.filter((e) => e.table === "operation_logs");
const auditStatusUpdates = (db) => db.state.logUpdates.filter((e) => e.table === "operation_logs");
const authCalls = (db, fn) => db.state.authCalls.filter((c) => c.fn === fn);

test("create success writes the intent before the side effect and completes the audit", async () => {
  const db = makeAdminDb();
  const result = await createAccount(db, 1, baseAccount);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, userId: 33 });
  const intent = auditIntents(db)[0];
  assert.equal(intent.row.action, "create");
  assert.equal(intent.row.details.status, "pending");
  assert.equal(intent.row.details.student_id, "20231001");
  assert.equal(intent.seq, 1, "the audit intent is the first write");
  const createUserCall = authCalls(db, "createUser")[0];
  assert.ok(intent.seq < createUserCall.seq, "audit intent is persisted before the Auth side effect");
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "completed");
  assert.equal(completion.row.details.stage, "done");
  assert.equal(completion.row.details.target_user_id, 33);
});

test("create failure after the intent leaves a failed audit record with the stage", async () => {
  const db = makeAdminDb({ createUser: { data: null, error: { message: "email exists" } } });
  const result = await createAccount(db, 1, baseAccount);
  assert.equal(result.status, 409);
  assert.match(result.body.error, /Auth 账号已存在或创建失败/);
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "failed");
  assert.equal(completion.row.details.stage, "auth_create");
});

test("create is cancelled and the side effect skipped when the audit intent fails", async () => {
  const db = makeAdminDb({ logInsert: { data: null, error: { message: "insert blocked" } } });
  const result = await createAccount(db, 1, baseAccount);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /审计意图/);
  assert.ok(!result.body.success);
  assert.equal(authCalls(db, "createUser").length, 0, "no Auth side effect without an audit intent");
  assert.equal(db.state.logUpdates.length, 0);
});

test("create never reports clean success when the audit status update fails", async () => {
  const db = makeAdminDb({ logUpdate: { error: { message: "update blocked" } } });
  const result = await createAccount(db, 1, baseAccount);
  assert.equal(result.status, 503);
  assert.ok(!result.body.success);
  assert.match(result.body.error, /审计状态更新失败/);
  assert.equal(authCalls(db, "createUser").length, 1, "the side effect itself did happen");
});

test("profile failure cleans up the Auth user and marks the audit failed", async () => {
  const db = makeAdminDb({ profileUpdate: { data: null, error: { message: "trigger" } } });
  const result = await createAccount(db, 1, baseAccount);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /已撤销新账号/);
  assert.equal(authCalls(db, "deleteUser").length, 1, "the temp Auth user is cleaned up");
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "failed");
  assert.equal(completion.row.details.stage, "profile");
  assert.equal(completion.row.details.cleaned_up, true);
});

test("delete success writes intent and completed status without secrets", async () => {
  const db = makeAdminDb({
    selectSingle: { data: targetUser, error: null },
  });
  const result = await deleteAccount(db, 1, 5);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  const intent = auditIntents(db)[0];
  assert.equal(intent.row.action, "delete");
  assert.equal(intent.row.details.status, "pending");
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "completed");
  const dump = JSON.stringify([...db.state.logInserts, ...db.state.logUpdates]);
  assert.ok(!dump.includes("auth-9"), "audit rows never contain Auth identifiers beyond the target id");
  assert.ok(!dump.toLowerCase().includes("password"));
  assert.equal(authCalls(db, "deleteUser").length, 1);
});

test("delete refuses users with history before any audit intent", async () => {
  const db = makeAdminDb({
    selectSingle: { data: targetUser, error: null },
    counts: { borrow_orders: { count: 3 } },
  });
  const result = await deleteAccount(db, 1, 5);
  assert.equal(result.status, 409);
  assert.match(result.body.error, /借用、归还或库存申请记录/);
  assert.equal(auditIntents(db).length, 0, "no side effect, no audit row");
  assert.equal(authCalls(db, "deleteUser").length, 0);
});

test("delete reports failure and marks the audit when the Auth delete fails", async () => {
  const db = makeAdminDb({
    selectSingle: { data: targetUser, error: null },
    deleteUser: { error: { message: "concurrent" } },
  });
  const result = await deleteAccount(db, 1, 5);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /删除登录账号失败/);
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "failed");
  assert.equal(completion.row.details.stage, "auth_delete");
});

test("reset success writes a completed audit and never logs the password", async () => {
  const db = makeAdminDb({ selectSingle: { data: targetUser, error: null } });
  const result = await resetPassword(db, 1, 5);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  const intent = auditIntents(db)[0];
  assert.equal(intent.row.action, "update");
  assert.equal(intent.row.details.type, "account_password_reset");
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "completed");
  assert.equal(completion.row.details.stage, "done");
  const dump = JSON.stringify([...db.state.logInserts, ...db.state.logUpdates]);
  assert.ok(!dump.includes("513base123"), "audit rows never contain the initial password value");
  assert.ok(!dump.includes('"password"'), "audit rows never carry a password field");
  assert.equal(authCalls(db, "updateUserById").length, 1);
});

test("reset marks the audit failed when the gate flag update fails", async () => {
  const db = makeAdminDb({
    selectSingle: { data: targetUser, error: null },
    usersUpdate: { error: { message: "trigger blocked" } },
  });
  const result = await resetPassword(db, 1, 5);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /首次改密标记设置失败/);
  assert.ok(!result.body.success);
  assert.equal(authCalls(db, "updateUserById").length, 1, "the password itself was already reset");
  const completion = auditStatusUpdates(db)[0];
  assert.equal(completion.row.details.status, "failed");
  assert.equal(completion.row.details.stage, "password_flag");
});

test("reset is cancelled and the password untouched when the audit intent fails", async () => {
  const db = makeAdminDb({
    selectSingle: { data: targetUser, error: null },
    logInsert: { data: null, error: { message: "insert blocked" } },
  });
  const result = await resetPassword(db, 1, 5);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /审计意图/);
  assert.equal(authCalls(db, "updateUserById").length, 0, "no password change without an audit intent");
});
