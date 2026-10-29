# Roo Code（GarfieldHuang fork）

> 您的 AI 驅動開發團隊，就在您的編輯器中

<details>
  <summary>🌐 其他語言</summary>

- [English](README.en.md)
- [Català](locales/ca/README.md)
- [Deutsch](locales/de/README.md)
- [Español](locales/es/README.md)
- [Français](locales/fr/README.md)
- [हिंदी](locales/hi/README.md)
- [Bahasa Indonesia](locales/id/README.md)
- [Italiano](locales/it/README.md)
- [日本語](locales/ja/README.md)
- [한국어](locales/ko/README.md)
- [Nederlands](locales/nl/README.md)
- [Polski](locales/pl/README.md)
- [Português (BR)](locales/pt-BR/README.md)
- [Русский](locales/ru/README.md)
- [Türkçe](locales/tr/README.md)
- [Tiếng Việt](locales/vi/README.md)
- [简体中文](locales/zh-CN/README.md)
- [繁體中文](README.md)
      </details>

---

## 關於這個 fork

官方的 [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) 已於 2026-05-15 停止維護並封存（archived），不再接受 PR，Marketplace 上的版本也停在 3.54.0。
這個 fork 從官方最後的 `main`（`b867ec9`）延伸，持續修正問題並跟上新模型，版本號從 **3.54.1** 起算。

### 與官方 3.54.0 的差異

**1. ChatGPT Plus/Pro（Codex OAuth）模型自動跟上最新**

- 登入後，Roo 會用您的 OAuth 憑證向 `https://chatgpt.com/backend-api/codex/models` 取得即時模型清單，做法與官方 Codex CLI 相同。OpenAI 推出新模型時會直接出現在模型選單，**不需要再改程式或更新擴充功能**。
- 只列出您的方案實際可用、且在 Codex 選單中公開的模型，依官方建議的優先順序排列。
- 清單會快取在 VS Code 中（1 小時內不重複抓取），離線或尚未登入時改用內建清單。
- 登出時會清除快取，換帳號或換方案後會重新抓取。
- 如果您目前選的模型已不在清單中，選單仍會保留它，避免畫面顯示的模型與實際使用的不一致。

**2. 內建模型清單更新**

- 新增 `gpt-6.1-sol`（新預設）、`gpt-6-astra`、`gpt-6.1-terra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`。
- `gpt-5.5` 依 Codex 後端實際規格修正為 272k 上下文、推理強度 low～xhigh。

**3. 新增推理強度 `max`**

- GPT-6 系列支援的最高推理等級，所有語系都已加上翻譯。
- Codex CLI 另有 `ultra`，但它依賴 Codex CLI 自己的多代理任務委派，Roo 無法使用，因此不提供。

**4. 修正：新版 VS Code 下任務卡在「正在處理 API 請求」**

- 新版 VS Code 把內建的 ripgrep 從 `@vscode/ripgrep/bin/` 搬到 `@vscode/ripgrep-universal/bin/<平台>-<架構>/`。
- 官方版找不到 ripgrep，每個任務在送出 API 請求前就失敗（log 顯示 `Could not find ripgrep binary`）。這個 fork 會一併搜尋新路徑。

**5. 輸入框可以貼上、拖曳或選取任何檔案**

- **貼上**：在檔案總管複製檔案後，直接在輸入框按 `Ctrl+V`。截圖等圖片照舊附加為圖片，其他檔案會存到擴充功能的儲存空間並以 `@` 提及插入。
- **拖曳**：從檔案總管拖檔案進來時仍需**按住 Shift**（這是 VS Code 對 webview 的限制，擴充功能無法改變）。官方版只收圖片，這個 fork 連其他檔案也會收。
- **迴紋針按鈕**：輸入框右上角原本的「新增圖片」改成「新增檔案或圖片」，可以選取任何檔案。工作區內的檔案以相對路徑提及，工作區外的以絕對路徑提及，都不會另外複製。即使模型不支援圖片，這個按鈕也能用。
- `@` 提及 PDF、Word（.docx）、Excel（.xlsx）時會抽出文字內容，官方版會當作二進位檔直接略過。

### 安裝

這個 fork 沒有上架 Marketplace，請自行打包 VSIX 安裝。需要 Node.js 20.19.2（其他版本通常也可以）與 pnpm 10.8.1：

```bash
git clone https://github.com/GarfieldHuang/Roo-Code.git
cd Roo-Code
pnpm install
pnpm vsix --force
code --install-extension bin/roo-cline-3.54.1.vsix --force
```

- 安裝後執行 `Developer: Reload Window`。設定 →「關於 Roo Code」應顯示 `3.54.1`。
- 擴充功能 ID 與官方版相同（`RooVeterinaryInc.roo-cline`），會直接取代官方版，原本的設定、API 設定檔與 OAuth 登入都會保留。
- 打包時請加 `--force`。否則 turbo 可能沿用舊的 webview 建置快取，導致「關於」頁顯示的版本號不正確。

### 使用 ChatGPT 訂閱的模型

1. 設定 → 供應商 → API 供應商選「OpenAI - ChatGPT Plus/Pro」，按「Sign in to OpenAI Codex」登入。
2. 「模型」下拉選單會顯示即時清單，建議選 `gpt-6.1-sol`（日常開發）或 `gpt-6-astra`（最困難的任務）。
3. 按「儲存」。

---

## Roo Code 能為您做什麼？

- 從自然語言描述與規格產生程式碼
- 依工作切換模式：程式碼、架構師、詢問、偵錯與自訂模式
- 重構和偵錯現有程式碼
- 撰寫和更新文件
- 回答關於程式碼庫的問題
- 自動化重複性工作
- 使用 MCP 伺服器

## 模式

Roo Code 會配合您的工作方式：

- **程式碼模式**：日常開發、編輯與檔案操作
- **架構師模式**：規劃系統、規格與遷移
- **詢問模式**：快速回答、解釋與文件
- **偵錯模式**：追蹤問題、加入 log、找出根本原因
- **自訂模式**：為團隊或工作流程建立專用模式

更多資訊：[使用模式](https://roocodeinc.github.io/Roo-Code/basic-usage/using-modes) • [自訂模式](https://roocodeinc.github.io/Roo-Code/advanced-usage/custom-modes)

## 資源

- **[官方文件](https://roocodeinc.github.io/Roo-Code/)**：安裝、設定與使用 Roo Code 的官方指南。
- **[這個 fork 的 Issues](https://github.com/GarfieldHuang/Roo-Code/issues)**：回報這個 fork 的問題。官方 repo 已封存，無法再開 issue。

---

## 免責聲明

官方 Roo Code 擴充功能已於 2026 年 5 月 15 日停止服務。

- 若您在尋找其他替代方案，可參考 [ZooCode](https://github.com/Zoo-Code-Org/Zoo-Code/)（由 Roo Code 社群發起的 fork）與 [Cline](https://cline.bot/)（Roo Code 的源頭）。
- 若您曾是付費使用者並有帳務問題，請寫信至 [billing@roocode.com](mailto:billing@roocode.com)。

**請注意**，Roo Code, Inc. **不**對與 Roo Code 相關的任何程式碼、模型或其他工具、任何相關的第三方工具，或由此產生的任何輸出作出任何陳述或保證。您承擔使用這些工具或輸出的**所有風險**；這些工具均按**「原樣」**及**「可用」**的基礎提供。風險可能包括但不限於智慧財產權侵權、網路漏洞或攻擊、偏見、不準確、錯誤、缺陷、病毒、停機、財產損失或損害及/或人身傷害。您須對自己使用這些工具或輸出負全部責任（包括但不限於其合法性、適當性與結果）。

這個 fork 由個人維護，同樣不提供任何保證。

---

## 授權

[Apache 2.0 © 2026 Roo Code, Inc.](./LICENSE)
