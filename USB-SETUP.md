# ESP32 实测接入（2026-10-28）

来源：minskwang/flight-lab 私有仓库 main，页面最新提交 aac786d1d7a6eb1b29708d6df09a0cde9f7a144b。基于该版本加入浏览器 USB 只读姿态功能。

## 使用

1. Chrome 打开本地测试页 http://127.0.0.1:8788，或部署更新后的 HTTPS 网站。
2. ESP32 使用 jugend-msp-reader 0.2.0 固件；GPIO21 → 飞控 R2，GPIO20 ← T2，GND 共地。UART2 MSP 115200。
3. 关闭占用该串口的终端/串口监视器，点 **ESP32 verbinden**，选择 USB JTAG/serial debug unit。
4. 页面核对 INFO、FCINFO，并自动读取一次 ATTITUDE。之后点 **Lage lesen** 获取新测量；数值是单次测量，不会自动刷新。
5. **Messdaten exportieren** 导出时间、原始响应、MSP payload、往返延迟、身份和错误。最多保留最近 10000 条，刷新会清空；需要时先导出。
6. 要让 AI 状态查询看到真实角度，主动勾选数据共享，并在查询前 5 秒内点 Lage lesen。勾选前数据只在浏览器；勾选后状态查询会将角度与时间发给 OpenAI。断开 USB 自动清除勾选。

AI 飞行操作继续使用模拟器；真实姿态在独立 hardware 字段，不能推出位置、高度、电量或可飞行状态。没有任何电机/解锁/RC 写入。

本机服务没有配置云端密钥，能测试 USB；云端 API 验证须在部署后使用原有 Render 密钥。本次没有读取或复制云端密钥。网站登录密码与 API key 均不要写入源码。

## 运行和验证

需要 Node.js >=22，无新增 npm 依赖：

```sh
PORT=8788 node server.mjs
node --test
```

新增 serial.mjs、hardware-ui.mjs，并加入 server.mjs 的静态文件白名单。超时关闭串口，避免迟到响应误配。姿态 JSON 与 MSP 原始字节互相核对。

自动化覆盖：分片响应、固件身份不匹配、超时清理、只读命令白名单、payload 不符、MSP 错误、共享开关、过期/断开数据、工具结果回传、重复/取消调用。

OpenAI 工具结果机制核对：https://developers.openai.com/api/docs/guides/realtime-conversations
