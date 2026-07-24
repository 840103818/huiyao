import { Button, Checkbox, Form, Input, InputNumber, Message, Modal, Radio, Tag } from "@arco-design/web-react";
import { IconCheckCircle, IconDesktop, IconLeft, IconLink, IconLock, IconMoon, IconSave, IconSun } from "@arco-design/web-react/icon";
import { useState } from "react";
import { getErrorMessage, saveSettings, testConnection } from "../lib/bridge";
import type { PublicSettings, SettingsInput, ThemeMode } from "../types";

interface SettingsViewProps {
  settings: PublicSettings;
  onBack: () => void;
  onSaved: (settings: PublicSettings) => void;
  onThemeChange: (theme: ThemeMode) => Promise<void>;
}

export function SettingsView({ settings, onBack, onSaved, onThemeChange }: SettingsViewProps) {
  const [message, messageContext] = Message.useMessage();
  const [modal, modalContext] = Modal.useModal();
  const [form] = Form.useForm<SettingsInput>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [theme, setTheme] = useState(settings.theme);

  const initialValues: SettingsInput = {
    baseUrl: settings.baseUrl, model: settings.model, timeoutSeconds: settings.timeoutSeconds,
    theme: settings.theme, apiKey: "", clearApiKey: false,
  };

  const handleBack = () => {
    if (!dirty) { onBack(); return; }
    modal.confirm?.({
      title: "放弃未保存的修改？",
      content: "模型服务配置尚未保存，返回后修改将丢失。",
      okText: "放弃修改",
      cancelText: "继续编辑",
      onOk: onBack,
    });
  };

  const values = async (): Promise<SettingsInput> => ({ ...(await form.validate()), theme });
  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveSettings(await values());
      onSaved(saved);
      setDirty(false);
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
      message.success?.(`${status.message} · ${status.model}`);
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
          <Button shape="circle" type="text" icon={<IconLeft />} onClick={handleBack} aria-label="返回工作台" />
          <div><span>模型与外观</span><h1>系统设置</h1></div>
        </header>
        <Form<SettingsInput>
          form={form}
          initialValues={initialValues}
          layout="vertical"
          onChange={() => setDirty(true)}
          onSubmit={() => void handleSave()}
        >
          <section className="settings-section">
            <header><IconLink /><div><h2>模型服务</h2><p>OpenAI Chat Completions 兼容接口</p></div></header>
            <div className="settings-fields">
              <Form.Item label="Base URL" field="baseUrl" rules={[{ required: true, message: "请输入 Base URL" }, { match: /^https?:\/\/[^\s]+$/i, message: "请输入有效的 HTTP(S) 地址" }]}>
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item label="模型名称" field="model" rules={[{ required: true, message: "请输入模型名称" }]}>
                <Input placeholder="gpt-4.1-mini" />
              </Form.Item>
              <Form.Item
                className="api-key-item"
                label={<span>API Key {settings.hasApiKey ? <Tag color="green" icon={<IconCheckCircle />}>已存入钥匙串</Tag> : null}</span>}
                field="apiKey"
              >
                <Input.Password prefix={<IconLock />} placeholder={settings.hasApiKey ? "留空则保持现有密钥" : "输入 API Key"} autoComplete="off" />
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
          <section className="settings-section">
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
    </main>
  );
}
