import assert from "node:assert/strict";
import test from "node:test";
import {
  ROLE_ORDER,
  accountFormError,
  groupUsersByRole,
  normalizeAccountInput,
} from "../src/lib/accountAdmin.ts";

const validInput = {
  studentId: " 20231001 ",
  name: " 张三 ",
  department: " 宣传部 ",
  phone: "13812345678",
  role: "member",
  email: "",
  position: "",
  notes: "",
};

test("valid account input passes and is normalized", () => {
  assert.equal(accountFormError(validInput), null);
  const input = normalizeAccountInput(validInput);
  assert.deepEqual(input, {
    studentId: "20231001",
    name: "张三",
    department: "宣传部",
    phone: "13812345678",
    role: "member",
    email: "",
    position: "",
    notes: "",
  });
});

test("account validation rejects the same fields as batch import", () => {
  assert.match(accountFormError({ ...validInput, studentId: "BAD ID" }) ?? "", /学号/);
  assert.match(accountFormError({ ...validInput, studentId: "a" }) ?? "", /学号/);
  assert.match(accountFormError({ ...validInput, name: "" }) ?? "", /姓名/);
  assert.match(accountFormError({ ...validInput, department: "" }) ?? "", /部门/);
  assert.match(accountFormError({ ...validInput, phone: "10012345678" }) ?? "", /手机号/);
  assert.match(accountFormError({ ...validInput, role: "boss" }) ?? "", /身份/);
  assert.match(accountFormError({ ...validInput, email: "not-an-email" }) ?? "", /邮箱/);
  assert.match(accountFormError({ ...validInput, position: "长".repeat(81) }) ?? "", /职位或备注/);
  assert.match(accountFormError({ ...validInput, notes: "长".repeat(501) }) ?? "", /职位或备注/);
});

test("all three roles are accepted for account creation", () => {
  for (const role of ROLE_ORDER) {
    assert.equal(accountFormError({ ...validInput, role }), null);
  }
});

test("groups are ordered super_admin, admin, member and sorted by name inside", () => {
  const users = [
    { id: 1, role: "member", name: "王五" },
    { id: 2, role: "admin", name: "李四" },
    { id: 3, role: "super_admin", name: "阿明" },
    { id: 4, role: "member", name: "陈六" },
    { id: 5, role: "member", name: "白露" },
  ];
  const groups = groupUsersByRole(users);
  assert.deepEqual(groups.map((group) => group.role), ["super_admin", "admin", "member"]);
  assert.deepEqual(groups.map((group) => group.label), ["超级管理员", "部门管理员", "普通用户"]);
  assert.deepEqual(groups[0].users.map((user) => user.id), [3]);
  assert.deepEqual(groups[2].users.map((user) => user.name), ["白露", "陈六", "王五"]);
});
