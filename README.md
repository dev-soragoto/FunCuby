# FunCuby

[English](#english) | [中文](#中文)

## English

FunCuby is an unofficial open-source web tool for CubyFun easyplay 1s that connects to your device over Bluetooth for MIDI playback and practice

[Click here to use](https://funcuby.pages.dev/)

### Features

- Device: Bluetooth connection, live key display and first-key calibration
- Test: Send MIDI messages and raw HEX packets to test device responses
- Play: Import MIDI files, select tracks, adjust speed and play
- Practice: Follow-along mode, rhythm game scoring, loops and latency calibration
- Logs: View, import and export communication logs

### Usage

Install Node.js (the project uses Node.js 26), then run in the project directory:

```sh
npm start
```

Open <http://localhost:5173> and connect your keyboard on the Device page.

For Bluetooth connections, use a browser that supports Web Bluetooth, such as Chrome, and open the site over localhost or HTTPS.

Licensed under the [MIT License](LICENSE).

If this project helped you, please give it a [Star ⭐]

## 中文

FunCuby 是 CubyFun easyplay 1s 的非官方开源网页工具，通过蓝牙连接设备，支持 MIDI 演奏和练习

[点这里使用](https://funcuby.pages.dev/)

### 功能

- 设备：蓝牙连接、实时按键显示、首键校准
- 测试：发送 MIDI 消息和原始 HEX 报文，测试设备响应
- 演奏：导入 MIDI 文件，选择音轨、调整速度并播放
- 练习：跟练、音游评分、循环练习和延迟校准
- 日志：查看、导入和导出通信记录

### 使用

安装 Node.js（项目使用 Node.js 26），在项目目录运行：

```sh
npm start
```

打开 <http://localhost:5173>，在 设备 页面连接键盘。

蓝牙连接请使用支持蓝牙的浏览器，如 chrome ，通过 localhost 或 HTTPS 访问。

本项目采用 [MIT 协议](LICENSE)。

如果项目帮助了你，请给我点个 [Star ⭐]
