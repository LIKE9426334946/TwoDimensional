# TwoDimensional

二维矩阵变换可视化网页。输入 2 × 2 矩阵 A 和二维列向量 v，在画布中拖动输入向量的实心箭头，即时显示 Av 及其移动轨迹。

## 页面与功能

- 主页面 `/`：坐标系、各向量的输入与变换结果；当前变换矩阵固定显示在画布左上角。
- 管理页 `/admin`：矩阵与向量键盘输入、向量添加和删除、显示设置，以及可拖动的实时预览。
- 数值支持整数、小数、分数（如 `1/2`）和科学计数法；无效输入标红，保留上次有效值。
- 只有输入向量箭头的实心三角形可以启动拖动；线段、标签、空白区域和变换结果箭头不能启动拖动。
- 多向量使用不同配色与编号；输入为实线，输出为虚线，淡色线为输出端点轨迹。
- 矩阵的两列直接画为绿色向量 `Ae₁ = (A[0][0], A[1][0])`、`Ae₂ = (A[0][1], A[1][1])`；以灰蓝色虚线单位正方形为参照，绿色半透明平行四边形表示其变换结果。主页面和管理预览均实时更新；这些矩阵向量由管理页的矩阵输入控制。
- 即使删除全部输入向量，矩阵向量和区域仍会显示。零矩阵不绘制虚假的方向箭头，奇异矩阵的区域可退化为直线。
- 坐标范围默认较短轴为 `[-6, 6]`，在画布右下角手动调整。网格充分利用画布宽度和高度，较长轴显示更大范围；下方同时显示 x、y 轴的实际范围。修改矩阵、输入坐标、增加向量和拖动均不会自动缩放。
- 网格使用相同的 x、y 单位长度；画布随窗口适配，始终保留用户设置的数值范围。
- 参数自动保存到服务器 JSON；打开的管理页和主页面通过 SSE 同步。拖动先在本页即时显示，再合并发送更新。
- 修改矩阵后重新记录轨迹；可隐藏或清空轨迹。轨迹是当前页面打开期间的观察记录，刷新页面后从当前位置重新记录。
- 支持删除全部向量；最多 24 个输入向量。删除后保留其他向量的编号。

计算方式：

```text
x' = A[0][0] × x + A[0][1] × y
y' = A[1][0] × x + A[1][1] × y
```

## 部署配置

| 项目 | 配置 |
| --- | --- |
| 系统与用户 | Ubuntu，root |
| 项目路径 | /opt/TwoDimensional |
| 仓库分支 | main |
| 外部端口 / Nginx | 16005 |
| Node.js 内部地址 | 127.0.0.1:3005 |
| systemd 服务 | TwoDimensional.service |
| Node.js | 22 或更高版本 |
| 数据文件 | /opt/TwoDimensional/data/state.json |

使用 Node.js 原生 HTTP 服务、浏览器 Canvas、HTML/CSS/JavaScript，无数据库和第三方运行依赖，无前端构建步骤。管理页直接通过 `/admin` 访问。

### 1. 安装环境

以下命令以 root 执行，不使用 sudo：

```bash
apt update
apt install -y git curl ca-certificates nginx
```

已安装 Node.js 22 或更高版本时，跳过以下 Node.js 安装命令：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/twodimensional-node-setup.sh
bash /tmp/twodimensional-node-setup.sh
apt install -y nodejs
/usr/bin/node -v
npm -v
```

服务文件使用 `/usr/bin/node`。如使用其他安装路径，请同步修改服务文件中的 `ExecStart` 及部署脚本的检查路径。

### 2. 获取项目

```bash
git clone --branch main https://github.com/LIKE9426334946/TwoDimensional.git /opt/TwoDimensional
cd /opt/TwoDimensional
```

项目无第三方依赖，可以直接启动，无需 npm install。

### 3. 安装服务与 Nginx 配置

```bash
cd /opt/TwoDimensional
bash deploy/deploy.sh
```

脚本先执行 JavaScript 语法检查、矩阵/箭头几何检查及 API/数据持久化测试，然后安装配置并检查 `nginx -t`。服务开机自启、异常退出自动重启。脚本可重复运行，不会覆盖 `data/state.json`。

在云服务器安全组中放行 TCP `16005`。如果服务器已启用 UFW：

```bash
ufw allow 16005/tcp
```

访问：

```text
主页面：http://服务器IP:16005/
管理页：http://服务器IP:16005/admin
```

### 4. 检查与日志

```bash
curl --fail http://127.0.0.1:3005/api/health
curl --fail http://127.0.0.1:16005/api/health
systemctl status TwoDimensional --no-pager
journalctl -u TwoDimensional -n 50 --no-pager
```

两个健康检查应返回 `{"ok":true,"project":"TwoDimensional"}`。

Nginx 配置在 `deploy/TwoDimensional.nginx.conf`，已为 SSE 关闭代理缓冲并设置长连接超时，保证不同页面实时同步；普通代理路径同时包含 WebSocket 升级配置。同一端口仅启用一份项目配置。

## 更新

```bash
cd /opt/TwoDimensional
git pull --ff-only origin main
bash deploy/deploy.sh
```

## 本地启动与验证

```bash
npm run verify
npm start
```

然后访问 `http://127.0.0.1:3005/` 和 `http://127.0.0.1:3005/admin`。如需通过本地局域网测试：

```bash
HOST=0.0.0.0 PORT=3005 npm start
```

环境变量：`HOST`、`PORT`、`DATA_DIR`。生产环境由 systemd 指定本机监听地址与内部端口，不需要运行额外的开发服务器。

GitHub Actions 在推送 main 时运行相同的 `npm run verify` 检查。自动测试覆盖数字解析、矩阵方向、箭头命中、零向量、固定坐标范围、并发字段更新、SSE、重复请求及保存后重启读取。浏览器外观与真实鼠标交互仍可在部署后手动核验。

## 数据保存与备份

矩阵、向量、向量编号、坐标范围和显示开关保存到 `data/state.json`。首次启动自动创建；运行数据被 Git 忽略。

备份 `data` 目录即可保存所有持久化参数。恢复时停止服务，替换数据后启动：

```bash
systemctl stop TwoDimensional
# 将备份中的 state.json 放回 /opt/TwoDimensional/data/state.json
systemctl start TwoDimensional
```

写入使用临时文件和原子重命名，更新按字段串行提交。数据损坏时服务报告错误并保留原文件。

## 项目结构

```text
server.mjs                    Node.js 页面/API/SSE 服务
shared/model.mjs              参数校验、矩阵计算、状态操作
shared/geometry.mjs           坐标换算与箭头命中几何
public/index.html             主展示页
public/admin.html             管理页
public/assets/                样式与图标
public/js/                    同步逻辑、Canvas 绘制、页面交互
data/state.json               运行时自动生成的 JSON 数据
deploy/                       systemd、Nginx 与部署脚本
tests/                        数学、几何、HTTP 与持久化测试
```
