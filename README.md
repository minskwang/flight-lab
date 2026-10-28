# USB hardware telemetry update (2026-10-28)

Chrome/Edge can connect to ESP32-C3 over Web Serial and read Matrix G4 attitude through MSP. All movement commands remain simulated. Use **ESP32 verbinden**, then **Lage lesen** for a new single measurement. Hardware data stays in the browser unless the user opts in to share recent attitude with OpenAI status queries. See [USB-SETUP.md](USB-SETUP.md).

Validation: six automated tests (`node --test`) and a successful local browser → ESP32 → FC attitude read. Cloud AI hardware-query validation is separate.

# Flight Lab — OpenAI Realtime (current version)

Updated 2026-10-28: the active app uses OpenAI Realtime again. German UI, Chinese/German/English audio, three simulator tools, WebRTC, and cloud password protection are retained. No Jev requests are made. Older Jev files are inactive reference code.

Local setup: `configure-key.cmd`, then `start.cmd`. Cloud setup: `OPENAI_API_KEY` in Render's secret environment variables, plus `SITE_PASSWORD`. See DEPLOY.md. Model defaults to the previously used `gpt-realtime-2.1`; override with `OPENAI_REALTIME_MODEL`. The standard key stays server-side; `/api/session` exchanges browser SDP through OpenAI's unified Realtime interface.

Tests use a mocked OpenAI response and do not establish real account access or live microphone performance. Actual voice testing requires a valid key and API credit.

## Historical Jev version (superseded)

The active app now uses TypeSafe Jev, not an OpenAI Realtime LLM. UI remains German.

1. Create a key at https://console.typesafe.ai and run `configure-typesafe-key.cmd`. Input is hidden; Windows DPAPI stores it separately from the old OpenAI key. Never paste keys into chat.
2. Run `start.cmd`, open http://127.0.0.1:8787 and choose **Jev aktivieren**.
3. Send a text instruction, or choose Deutsch / English / 中文 and click **Sprachbefehl aufnehmen** for each command. Browser speech recognition is browser/service-dependent, may send audio to the browser provider, and is not guaranteed in embedded browsers. Text works independently of microphone support.

The server calls https://api.typesafe.ai/v1/systemone with `jev-latest` (override using `TYPESAFE_MODEL`). Credentials come from `TYPESAFE_API_KEY` or `secrets/typesafe-key.dpapi` and never reach the browser. No OpenAI calls or LLM fallback are made by the active app. Historical OpenAI utilities below are retained only as reference.

Jev selects one action and, for movement, four axis signs, strength (0.2/0.4/0.6), and duration (350/600/1000/2000 ms). Code converts these choices into the existing three simulator tools. This is bounded selection, not arbitrary numeric extraction or conversational text generation. Multi-step/unsupported requests should be clarified rather than executed. Model confidence below 0.75 or selected probability below 0.8 blocks a command; these prototype thresholds are not validated flight-safety guarantees. Late responses after disconnect or emergency stop are discarded. Only simulation is supported.

Validation: `node --test --test-isolation=none`. The Jev tests use mock responses and do not establish live model accuracy. Live voice-to-Jev validation requires a TypeSafe key and working browser speech recognition.

Official references: https://docs.typesafe.ai/api and https://docs.typesafe.ai/confidence.

## Historical Realtime version (superseded)

本地原型，只连接 OpenAI，不连接 ESP32、飞控或真实无人机。中文、德语、英语音频经 WebRTC 发送给 Realtime，模型调用三个函数，网页验证参数、更新模拟状态并把执行结果回传给模型。没有额外 npm 依赖，使用 Node.js 22+。

## 使用

1. 首次使用：双击 `configure-key.cmd`。在本机窗口粘贴 OpenAI API key 后按 Enter。输入不会显示。密钥不应发送到聊天里。
2. 双击 `start.cmd`。保留服务窗口，打开 http://127.0.0.1:8787 。如果服务已运行，直接访问页面即可。
3. 点击「连接麦克风与 AI」，允许麦克风。推荐 Chrome / Edge；若内置浏览器不提供麦克风接口，请在外部浏览器打开相同地址。
4. 说「起飞」，等待成功后说「往左前方飞一点」。继续说「Flieg ein bisschen nach rechts」或「What is the drone status?」。
5. 测试完点击「断开」。关闭服务窗口会停止本地服务；已建立的浏览器连接仍需通过页面断开。

密钥创建：https://platform.openai.com/api-keys 。仅当出现额度错误时检查 API Billing：https://platform.openai.com/settings/organization/billing/overview 。ChatGPT 订阅与 API 用量分开。

## 怎样判断确实连通

每次连接都会从地面重新开始模拟。连接成功后说「起飞」，应出现来源为 **Realtime AI** 的 `flight_action({action:"takeoff"})`，接着说移动意图，出现 `move_drone` 的五个参数与结果，状态查询出现 `get_drone_status({})`。

页面四个步骤指示分别代表取得麦克风、Realtime 连接、收到工具调用、显示结果。要验证完整的语音链路，还必须看到「麦克风转写」与对应的 Realtime AI 工具结果；文字输入只能证明文字链路。导出的 JSON 记录区分「本地演示」「本地按钮」「Realtime AI」及输入来源。转写为独立辅助过程，可能比工具调用晚到，不保证逐字等同模型听到的内容。

「本地演示」只展示固定参数，不调用 AI，不证明网络或语音连通。实际 API key、余额、模型访问、浏览器麦克风及网络均需在用户机器上验证。

## 工具约定

| 工具 | 参数 / 行为 |
|---|---|
| `move_drone` | `forward,right,vertical,yaw` 均为 −1..1 数值；`duration_ms` 为 100..2000 的整数。正方向分别为前、右、上、右转。未起飞则拒绝。|
| `flight_action` | `action` 为 `takeoff`, `land`, `hover`, `emergency_stop`, `reset`。紧急停止后需明确重置。|
| `get_drone_status` | 无参数，返回模拟模式、固定模拟电量、位置、偏航、最后指令。|

位移是固定参考方向的示意单位，不是米，也不是动力学或闭环控制；`duration_ms` 用于示意位移积分，页面直接更新最终位置，没有模拟真实电机时序。偏航不旋转位移坐标系。不可把这些函数直接用于真实飞行。

## 密钥和本地边界

- 长期 key 只在服务进程内解密使用，通过 HTTPS 发给 `api.openai.com`。网页只收到 SDP，不收到 key。
- `secrets/api-key.dpapi` 使用 Windows 当前用户 DPAPI 加密；只能在对应 Windows 用户环境解密。它不防御已经能够以该用户身份运行的恶意程序。
- 可通过服务端环境变量 `OPENAI_API_KEY` 提供密钥，该变量优先于加密文件。不要把 key 写进前端或提交到版本控制。
- 更换 key：重新运行 `configure-key.cmd`，并重启本地服务；环境变量提供的 key 也需要更新。撤销 key 应在 Platform 操作。
- 服务只监听 `127.0.0.1`，校验 Host 和 Origin，仅允许白名单静态文件，不提供密钥文件下载。勿将本机端口公开到互联网。
- 语音发送给 OpenAI；程序不把音频写入磁盘。转写和测试结果只留在当前页面，除非手动导出。

## 实现和维护

`server.mjs` 使用官方统一 WebRTC 接口 `/v1/realtime/calls`，默认模型 `gpt-realtime-2.1`，可通过 `OPENAI_REALTIME_MODEL` 修改。`config.mjs` 定义会话、工具和三语提示词。`public/app.mjs` 处理浏览器麦克风、连接和事件；`public/simulator.mjs` 只执行完成的工具调用，拒绝无效参数并按 call ID 去重。重连、取消和网络错误时释放麦克风。

为减少安装复杂度，选用官方原生 WebRTC 方案，没有引入 Agents SDK、打包器或外部 CDN。回应为页面文字，不播放 AI 合成语音。

官方依据（2026-09-23 核对）：
- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/docs/guides/realtime-conversations

在项目目录执行 `node --test` 运行参数校验、状态转换、去重、取消、工具结果回传和本地 HTTP 边界测试。测试不花 API 额度，不能替代真实语音验收。

## 人工语音验收

| 说的话 | 预期 |
|---|---|
| 起飞 | flight_action takeoff |
| 往左前方飞一点 | move_drone：forward > 0，right < 0 |
| Flieg ein bisschen nach rechts | move_drone：right > 0 |
| Go up a little | move_drone：vertical > 0 |
| What is the drone status? | get_drone_status |
| 停一下 / Stopp / Hover | flight_action hover |
| 不要起飞 | 不应执行 takeoff |
| 往那边飞 | 方向不足时应询问 |
| 紧急停止 | emergency_stop；后续移动应被拒绝 |

看到错误：401 检查 key；429 检查额度和限流；403 检查项目访问权限；WebRTC 超时检查 VPN / 防火墙 / 网络；麦克风被拒绝则在浏览器允许后重试。
