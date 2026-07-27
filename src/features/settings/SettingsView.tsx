import { Alert, Button, Checkbox, Form, Input, InputNumber, Message, Modal, Popconfirm, Radio, Tag } from "@arco-design/web-react";
import { IconCheckCircle, IconDelete, IconDesktop, IconLink, IconLock, IconMoon, IconSave, IconStorage, IconSun } from "@arco-design/web-react/icon";
import { useEffect, useState } from "react";
import { clearOriginalImages, getErrorMessage, getOriginalStorageStats, saveSettings, testConnection } from "../../infrastructure/tauri";
import type { PublicSettings, SettingsInput, ThemeMode } from "../../shared/contracts";
import { formatBytes } from "../image-input/image";

interface SettingsViewProps {
  settings: PublicSettings;
  onSaved: (settings: PublicSettings) => void;
  onThemeChange: (theme: ThemeMode) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onOriginalsCleared?: () => void | Promise<void>;
}

export function SettingsView({ settings, onSaved, onThemeChange, onDirtyChange, onOriginalsCleared }: SettingsViewProps) {
  const [message, messageContext] = Message.useMessage();
  const [modal, modalContext] = Modal.useModal();
  const [form] = Form.useForm<SettingsInput>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [theme, setTheme] = useState(settings.theme);
  const [confirmedHttpOrigin, setConfirmedHttpOrigin] = useState(settings.insecureHttpOrigin);
  const [originalStats, setOriginalStats] = useState({ count: 0, totalBytes: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const [clearingOriginals, setClearingOriginals] = useState(false);
  const [activeSection, setActiveSection] = useState("settings-model");

  const loadOriginalStats = async () => {
    setStatsLoading(true);
    try { setOriginalStats(await getOriginalStorageStats()); }
    catch (error) { message.error?.(getErrorMessage(error)); }
    finally { setStatsLoading(false); }
  };
  useEffect(() => { void loadOriginalStats(); }, []);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".settings-form");
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".settings-section"));
    if (!root || !sections.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (visible?.target.id) setActiveSection(visible.target.id);
    }, { root, rootMargin: "-8% 0px -70%", threshold: [0.1, 0.35, 0.6] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const openSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const initialValues: SettingsInput = {
    baseUrl: settings.baseUrl, model: settings.model, timeoutSeconds: settings.timeoutSeconds,
    theme: settings.theme, autoSaveHistory: settings.autoSaveHistory,
    insecureHttpOrigin: settings.insecureHttpOrigin, apiKey: "", clearApiKey: false,
    batchConcurrency: settings.batchConcurrency, storageQuotaBytes: settings.storageQuotaBytes,
    progressiveDisclosure: settings.progressiveDisclosure,
  };

  const values = async (): Promise<SettingsInput> => {
    const input = { ...(await form.validate()), theme };
    const url = new URL(input.baseUrl);
    if (url.protocol !== "http:" || isLocalHost(url.hostname)) return input;
    if (confirmedHttpOrigin === url.origin) return { ...input, insecureHttpOrigin: url.origin };
    const confirmed = await new Promise<boolean>((resolve) => {
      modal.confirm?.({
        title: "确认使用明文 HTTP？",
        content: `API Key 和请求内容将通过未加密连接发送到 ${url.origin}。仅在可信内网中使用。`,
        okText: "确认风险并继续",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) throw new Error("已取消明文 HTTP 操作");
    setConfirmedHttpOrigin(url.origin);
    return { ...input, insecureHttpOrigin: url.origin };
  };
  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings(await values());
      onSaved(saved);
      onDirtyChange(false);
      form.setFieldValue("apiKey", "");
      form.setFieldValue("clearApiKey", false);
      message.success?.("设置已保存");
    } catch (error) {
      if (!(error && typeof error === "object" && "errors" in error)) message.error?.(getErrorMessage(error));
    } finally { setSaving(false); }
  };
  const handleTest = async () => {
    setTesting(true);
    try {
      const status = await testConnection(await values());
      message.success?.(`${status.message} · ${status.model}，当前配置尚未保存`);
    } catch (error) {
      if (!(error && typeof error === "object" && "errors" in error)) message.error?.(getErrorMessage(error));
    } finally { setTesting(false); }
  };

  return (
    <main className="settings-view">
      {messageContext}
      {modalContext}
      <div className="settings-container">
        <header className="page-title-row">
          <div><span>绘钥偏好设置</span><h1>系统设置</h1></div>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            <button className={activeSection === "settings-model" ? "is-active" : undefined} aria-current={activeSection === "settings-model" ? "page" : undefined} type="button" onClick={() => openSection("settings-model")}><IconLink /><span>模型服务</span></button>
            <button className={activeSection === "settings-queue" ? "is-active" : undefined} aria-current={activeSection === "settings-queue" ? "page" : undefined} type="button" onClick={() => openSection("settings-queue")}><IconSave /><span>任务队列</span></button>
            <button className={activeSection === "settings-storage" ? "is-active" : undefined} aria-current={activeSection === "settings-storage" ? "page" : undefined} type="button" onClick={() => openSection("settings-storage")}><IconStorage /><span>原图存储</span></button>
            <button className={activeSection === "settings-appearance" ? "is-active" : undefined} aria-current={activeSection === "settings-appearance" ? "page" : undefined} type="button" onClick={() => openSection("settings-appearance")}><IconDesktop /><span>外观</span></button>
          </nav>
        <Form<SettingsInput>
          className="settings-form"
          form={form}
          initialValues={initialValues}
          layout="vertical"
          onChange={() => onDirtyChange(true)}
          onSubmit={() => void handleSave()}
        >
          <section id="settings-model" className="settings-section">
            <header><IconLink /><div><h2>模型服务</h2><p>OpenAI Chat Completions 兼容接口</p></div></header>
            <div className="settings-fields">
              <Form.Item label="Base URL" field="baseUrl" rules={[{ required: true, message: "请输入 Base URL" }, { match: /^https?:\/\/[^\s]+$/i, message: "请输入有效的 HTTP(S) 地址" }]}>
                <Input maxLength={2048} placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item label="模型名称" field="model" rules={[{ required: true, message: "请输入模型名称" }]}>
                <Input maxLength={200} placeholder="gpt-4.1-mini" />
              </Form.Item>
              <Form.Item
                className="api-key-item"
                label={<span>API Key {settings.hasApiKey ? <Tag color="green" icon={<IconCheckCircle />}>已存入钥匙串</Tag> : null}</span>}
                field="apiKey"
              >
                <Input.Password maxLength={4096} prefix={<IconLock />} placeholder={settings.hasApiKey ? "留空则保持现有密钥" : "输入 API Key"} autoComplete="off" />
              </Form.Item>
              <Form.Item label="请求超时" field="timeoutSeconds" rules={[{ required: true, message: "请输入超时时间" }]}>
                <InputNumber min={10} max={300} suffix="秒" />
              </Form.Item>
            </div>
            {settings.hasApiKey ? (
              <Form.Item field="clearApiKey" triggerPropName="checked" noStyle>
                <Checkbox>保存时清除钥匙串中的密钥</Checkbox>
              </Form.Item>
            ) : null}
            <Button icon={<IconLink />} loading={testing} onClick={() => void handleTest()}>测试连接</Button>
          </section>
          <section id="settings-queue" className="settings-section">
            <header><IconSave /><div><h2>任务队列</h2><p>批处理默认串行；双并发会更快地产生模型费用</p></div></header>
            <Form.Item label="模型并发数" field="batchConcurrency">
              <Radio.Group type="button"><Radio value={1}>串行（推荐）</Radio><Radio value={2}>两个并发</Radio></Radio.Group>
            </Form.Item>
            <Form.Item field="progressiveDisclosure" triggerPropName="checked" noStyle>
              <Checkbox>默认收起 EXIF、版本管理和诊断等高级信息</Checkbox>
            </Form.Item>
          </section>
          <section id="settings-storage" className="settings-section original-storage-section">
            <header><IconStorage /><div><h2>原图存储</h2><p>原图使用 Keychain 密钥加密并保存在应用私有目录</p></div></header>
            <div className="storage-metrics" aria-busy={statsLoading}>
              <div><span>已保留原图</span><strong>{statsLoading ? "--" : `${originalStats.count} 张`}</strong></div>
              <div><span>磁盘占用</span><strong>{statsLoading ? "--" : formatBytes(originalStats.totalBytes)}</strong></div>
            </div>
            {!statsLoading && originalStats.totalBytes >= settings.storageQuotaBytes * 0.8 ? <Alert type="warning" content={`原图存储已使用配额的 ${Math.round(originalStats.totalBytes / settings.storageQuotaBytes * 100)}%，建议及时管理存储。`} /> : null}
            <Form.Item label="原图软配额" field="storageQuotaBytes">
              <Radio.Group type="button"><Radio value={5 * 1024 ** 3}>5 GB</Radio><Radio value={10 * 1024 ** 3}>10 GB</Radio><Radio value={20 * 1024 ** 3}>20 GB</Radio></Radio.Group>
            </Form.Item>
            <Popconfirm
              title="清理全部原图？"
              content="此操作不可撤销，分析结果、提示词和缩略图会保留。"
              okText="永久清理"
              cancelText="取消"
              disabled={!originalStats.count || clearingOriginals}
              onOk={async () => {
                setClearingOriginals(true);
                try {
                  const count = await clearOriginalImages();
                  await onOriginalsCleared?.();
                  await loadOriginalStats();
                  message.success?.(`已清理 ${count} 张原图`);
                } catch (error) { message.error?.(getErrorMessage(error)); }
                finally { setClearingOriginals(false); }
              }}
            >
              <Button status="danger" type="outline" icon={<IconDelete />} loading={clearingOriginals} disabled={!originalStats.count}>清理全部原图</Button>
            </Popconfirm>
          </section>
          <section id="settings-appearance" className="settings-section">
            <header><IconDesktop /><div><h2>外观</h2><p>主题选择会立即保存并同步原生窗口</p></div></header>
            <Radio.Group
              className="theme-options"
              type="button"
              value={theme}
              disabled={savingTheme}
              onChange={async (value) => {
                const next = value as ThemeMode;
                const previous = theme;
                setTheme(next);
                setSavingTheme(true);
                try { await onThemeChange(next); }
                catch { setTheme(previous); }
                finally { setSavingTheme(false); }
              }}
            >
              <Radio value="system"><IconDesktop />跟随系统</Radio>
              <Radio value="light"><IconSun />浅色</Radio>
              <Radio value="dark"><IconMoon />深色</Radio>
            </Radio.Group>
          </section>
          <footer className="settings-footer">
            <span>密钥仅保存在 macOS 钥匙串中，不会写入应用配置。</span>
            <Button type="primary" htmlType="submit" size="large" icon={<IconSave />} loading={saving}>保存设置</Button>
          </footer>
        </Form>
        </div>
      </div>
    </main>
  );
}

function isLocalHost(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}
