/**
 * 演示数据种子：向运行中的 server 灌入一套多人协作场景。
 * 用法：先启动 server（pnpm dev），再 `pnpm seed`。
 */
const SERVER = process.env["SUPERTEAM_SERVER"] ?? "http://127.0.0.1:7300";

async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const r = await fetch(`${SERVER}/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as { error?: { message?: string } };
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${data?.error?.message ?? ""}`);
  return data as T;
}

async function transition(token: string, taskId: string, ...actions: string[]) {
  for (const action of actions) {
    await req("POST", `/tasks/${taskId}/transition`, { action }, token);
  }
}

async function main() {
  // 1. 三个演示成员（重复运行时容忍冲突）
  const wang = await req<{ token: string }>("POST", "/members", { name: "wang-demo", role: "lead" }).catch(() => null);
  const li = await req<{ token: string }>("POST", "/members", { name: "li-demo", role: "member" }).catch(() => null);
  const wangToken = wang?.token ?? process.env["SEED_WANG_TOKEN"];
  if (!wangToken) throw new Error("wang-demo 已存在且未提供 SEED_WANG_TOKEN，跳过");

  // 2. 任务：五个状态各一个
  const t1 = await req<{ id: string }>("POST", "/tasks", {
    title: "订单批量取消接口开发",
    dod: "① 幂等可重试 ② 单测覆盖批量分支 ③ 同步更新 specs/order.md",
    module: "order",
    tags: ["java", "order"],
    description: "履约模块新增 POST /orders/batch-cancel，支持最多 200 单批量取消。",
  }, wangToken);
  const t2 = await req<{ id: string }>("POST", "/tasks", {
    title: "退款对账定时任务",
    dod: "每日对账差异清零，异常告警到群里",
    module: "refund",
    tags: ["java"],
    description: "依赖批量取消的结果状态，每日 T+1 对账。",
  }, wangToken);
  const t3 = await req<{ id: string }>("POST", "/tasks", {
    title: "支付回调幂等修复",
    dod: "回调重试不重复扣款，补回归测试",
    module: "pay",
    tags: ["java", "bugfix"],
  }, wangToken);
  const t4 = await req<{ id: string }>("POST", "/tasks", {
    title: "订单模块 spec 与实现对齐",
    dod: "接口契约与代码一致，diff 过雷达",
    module: "order",
    tags: ["spec"],
  }, wangToken);
  const t5 = await req<{ id: string }>("POST", "/tasks", {
    title: "库存扣减接口防超卖设计",
    dod: "评审通过并出 ADR",
    module: "stock",
    tags: ["java", "design"],
  }, wangToken);

  // 3. 状态铺开：draft / coding / claimed / waiting_review / done
  await transition(wangToken, t2.id, "claim", "start");
  await transition(wangToken, t3.id, "claim");
  await transition(wangToken, t4.id, "claim", "start", "submit");
  await transition(wangToken, t5.id, "claim", "start", "submit", "approve");

  // 4. 依赖：退款对账依赖批量取消（interface 级）
  await req("PUT", `/tasks/${t2.id}/deps`, { deps: [{ dependsOnTaskId: t1.id, kind: "interface" }] }, wangToken);

  // 5. 知识档案：两张经验卡 + 一张 ADR + 一份 spec
  await req("POST", "/artifacts/propose", {
    type: "card",
    title: "支付回调幂等：用 idempotency-key 表",
    tags: ["java", "idempotency", "pay"],
    owner: "li-demo",
    body: "## 结论\n回调入口先查 idempotency_key 表，命中直接返回上次结果。\n\n## 适用场景\n所有第三方支付回调（微信/支付宝重试机制不可关）。\n\n## 要点\n- 唯一索引 (channel, out_trade_no)\n- 处理成功后才写结果，失败让回调方重试\n- 回归测试：mock 同一回调连发 3 次",
  }, wangToken);
  await req("POST", "/artifacts/propose", {
    type: "card",
    title: "zcode 注册新账号可领 3 亿 token 额度",
    tags: ["tool", "额度"],
    owner: "wang-demo",
    expires: "2026-12-31",
    body: "## 结论\n新注册账号可在官网领 3 亿 token，够全组跑一个月的蒸馏任务。\n\n## 要点\n- 一个手机号一个账号\n- 到期时间以官网为准，过期前把蒸馏任务迁到组内共享账号",
  }, wangToken);
  await req("POST", "/artifacts/propose", {
    type: "adr",
    title: "知识检索采用 SQLite FTS5",
    status: "accepted",
    tags: ["search", "architecture"],
    body: "## 背景\n团队知识库需要中文全文检索。\n\n## 决定\n用 FTS5 + unicode61，写入侧做 CJK 按字切分，查询侧转短语匹配；不引入外部分词器与独立搜索引擎。\n\n## 后果\n零部署成本；万级文档内检索 <100ms；若未来文档量上百万再评估 ES。",
  }, wangToken);
  await req("POST", "/artifacts/propose", {
    type: "spec",
    title: "订单模块",
    tags: ["java", "order"],
    owner: "wang-demo",
    body: "## 接口\n- POST /orders/batch-cancel（开发中，见任务看板）\n- GET /orders/{id}\n\n## 约定\n- 所有写接口必须幂等\n- 状态机：CREATED → PAID → CANCELING → CANCELED",
  }, wangToken);

  console.log("✅ 演示数据已写入：5 个任务（覆盖 5 种状态+依赖）、4 篇知识（card×2/adr/spec）");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
