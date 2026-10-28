# 云端部署（尚未发布）

使用 Render Web Service，平台提供 HTTPS 和 onrender.com 地址，无需购买域名。免费实例会休眠，适合模拟演示；OpenAI 的 API 费用另计。

1. 在 GitHub 创建一个私有仓库，只上传部署包内的文件。不要上传整个 ChatGPT 项目、secrets 文件夹、日志或密钥。
2. 登录 https://dashboard.render.com ，连接该仓库并创建 Blueprint，使用仓库根目录的 render.yaml。核对 Free 方案后创建。
3. 在 Render 的秘密环境变量中填写自己的 OPENAI_API_KEY。不要在聊天、源码或前端输入密钥。
4. Render 自动生成 SITE_PASSWORD。在控制台查看并保存这个网站密码，勿与 API key 混用。网站用户名固定为 flightlab。
5. 部署成功后，打开平台分配的 HTTPS 地址。在浏览器登录框输入用户名和网站密码，再测试文字及语音。

云端通过 RENDER_EXTERNAL_URL 自动限制允许的主机和来源。其他平台必须设置 PUBLIC_ORIGIN=https://你的完整域名、SITE_PASSWORD（至少20字符）、OPENAI_API_KEY 和 PORT，并提供 HTTPS 反向代理。缺少地址或密码时生产模式拒绝启动。不要直接向公网暴露 Node HTTP 端口。

没有配置公开网址时，本机仍只监听 127.0.0.1。Windows 加密密钥不随部署包上传。浏览器语音识别依赖设备支持，HTTPS 不保证所有浏览器都可语音输入。云端仍仅控制模拟器，不能控制家中 ESP32。

官方说明：https://render.com/docs/web-services
