(function (global) {
  "use strict";

  let api = null;
  let editing = false;
  let selectedKey = "";
  let selectedNode = null;
  let undoStack = [];
  let redoStack = [];

  const clone = (value) => global.WorkspaceStore.clone(value);

  function init(nextApi) {
    api = nextApi;
    document.addEventListener('mousedown', event => {
      if(editing && event.target.closest('[data-editor-action]') && selectedNode?.isConnected) event.preventDefault();
    });
  }
  function isEditing() { return editing; }

  function pushHistory() {
    if (!api) return;
    undoStack.push(clone(api.getState()));
    if (undoStack.length > 20) undoStack.shift();
    redoStack = [];
  }

  async function mutate(message, mutator) {
    pushHistory();
    const next = clone(api.getState());
    mutator(next);
    api.setState(next);
    api.render();
    await api.save(message || "修改已保存");
  }

  function enter() {
    if (editing) return;
    editing = true;
    document.body.classList.add("editing");
    api.render();
    api.toast("已进入编辑模式：点击文字或模块进行调整");
  }

  function exit() {
    if (!editing) return;
    editing = false;
    selectedKey = "";
    selectedNode = null;
    document.body.classList.remove("editing");
    api.render();
  }

  async function undo() {
    if (!undoStack.length) return api.toast("没有可以撤销的修改");
    redoStack.push(clone(api.getState()));
    const previous = undoStack.pop();
    api.setState(previous);
    api.render();
    await api.save("已撤销");
  }

  async function redo() {
    if (!redoStack.length) return api.toast("没有可以恢复的修改");
    undoStack.push(clone(api.getState()));
    const next = redoStack.pop();
    api.setState(next);
    api.render();
    await api.save("已恢复");
  }

  function select(node) {
    document.querySelectorAll(".editable-selected").forEach((item) => item.classList.remove("editable-selected"));
    selectedNode = node;
    selectedKey = node?.dataset?.editKey || "";
    if (node) node.classList.add("editable-selected");
    const label = document.querySelector("[data-editor-selection]");
    if (label) label.textContent = selectedKey ? `已选择：${node.textContent.trim().slice(0, 18) || selectedKey}` : "先点击一段文字";
  }

  function afterRender() {
    if (!editing) return;
    document.querySelectorAll("[data-edit-key]").forEach((node) => {
      node.setAttribute("contenteditable", "true");
      node.setAttribute("spellcheck", "false");
      node.addEventListener("focus", () => select(node));
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        select(node);
      });
      node.addEventListener("blur", () => { commitText(node).catch(error=>api.toast(error.message||"文字未保存")); });
    });
    if (selectedKey) {
      const found = document.querySelector(`[data-edit-key="${global.CSS?.escape ? CSS.escape(selectedKey) : selectedKey}"]`);
      if (found) select(found);
    }
  }

  async function commitText(node, refresh=true) {
    const key=node?.dataset.editKey,value=node?.textContent.trim();
    const current=api.getEditableValue?api.getEditableValue(key):api.getState().appearance.labels[key];
    if(!key||!value||value===current)return;
    const next=clone(api.getState());
    if(api.setEditableValue)api.setEditableValue(next,key,value);else next.appearance.labels[key]=value;
    pushHistory();api.setState(next);if(refresh)api.render();await api.save("文字已保存");
  }

  function adjustStyle(kind, delta, reset) {
    if (!selectedKey || !selectedNode) return api.toast("请先点选一段文字");
    const computed = getComputedStyle(selectedNode);
    const current = kind === "fontSize" ? parseFloat(computed.fontSize) : parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5;
    mutate("文字样式已保存", (state) => {
      const styles = state.appearance.textStyles[selectedKey] || {};
      if (reset) delete styles[kind];
      else styles[kind] = `${Math.max(kind === "fontSize" ? 10 : 12, current + delta).toFixed(1)}px`;
      state.appearance.textStyles[selectedKey] = styles;
    });
  }

  async function hideModule(moduleId) {
    const module = api.getTemplate().modules.find((item) => item.id === moduleId);
    if (!module || module.protected) return api.toast("这个核心模块不能隐藏");
    await mutate("模块已隐藏，可在已隐藏模块中恢复", (state) => {
      if (!state.navigation.hidden.includes(moduleId)) state.navigation.hidden.push(moduleId);
    });
  }

  async function restoreModule(moduleId) {
    await mutate("模块已恢复", (state) => {
      state.navigation.hidden = state.navigation.hidden.filter((id) => id !== moduleId);
    });
  }

  async function hideAction(actionId) {
    if (!actionId) return;
    await mutate("按钮已隐藏，可在已隐藏内容中恢复", (state) => {
      if (!state.appearance.hiddenActions.includes(actionId)) state.appearance.hiddenActions.push(actionId);
    });
  }

  async function restoreAction(actionId) {
    await mutate("按钮已恢复", (state) => {
      state.appearance.hiddenActions = state.appearance.hiddenActions.filter((id) => id !== actionId);
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
    if (file.size > 10 * 1024 * 1024) throw new Error("单张图片不能超过 10MB");
    const source = await readFile(file);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("图片无法解码")); image.src = source; });
    const limit = 1600;
    const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", .82);
  }

  async function addImage(file) {
    try {
      const src = await compressImage(file);
      await mutate("图片已插入", (state) => {
        state.assets.push({ id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, src, alt: file.name.replace(/\.[^.]+$/, ""), pageId: api.getRoute(), size: "m", createdAt: new Date().toISOString() });
      });
    } catch (error) { api.toast(error.message || "插入图片失败"); }
  }

  async function resizeImage(id, size) {
    if (!["s", "m", "l"].includes(size)) return;
    await mutate("图片尺寸已调整", (state) => {
      const asset = state.assets.find((item) => item.id === id);
      if (asset) asset.size = size;
    });
  }

  async function replaceImage(id, file) {
    try {
      const src = await compressImage(file);
      await mutate("图片已替换", (state) => {
        const asset = state.assets.find((item) => item.id === id);
        if (asset) {
          asset.src = src;
          asset.alt = file.name.replace(/\.[^.]+$/, "");
          asset.updatedAt = new Date().toISOString();
        }
      });
    } catch (error) { api.toast(error.message || "替换图片失败"); }
  }

  async function removeImage(id) {
    await mutate("图片已移除", (state) => { state.assets = state.assets.filter((item) => item.id !== id); });
  }

  function toolbar() {
    if (!editing) return "";
    return `<div class="edit-bar" role="toolbar" aria-label="页面编辑工具栏">
      <button class="button small primary" data-editor-action="exit">退出编辑</button>
      <span class="edit-bar-label" data-editor-selection>先点击一段文字</span>
      <button class="button small" data-editor-action="font-down">字号－</button>
      <button class="button small" data-editor-action="font-up">字号＋</button>
      <button class="button small" data-editor-action="line-down">行距－</button>
      <button class="button small" data-editor-action="line-up">行距＋</button>
      <button class="button small" data-editor-action="reset-style">恢复字号</button>
      <button class="button small" data-editor-action="undo" title="最多撤销 20 步">↶ 撤销</button>
      <button class="button small" data-editor-action="redo">↷ 恢复</button>
      <label class="button small">＋ 图片<input class="visually-hidden" type="file" accept="image/*" data-editor-image></label>
      <button class="button small" data-editor-action="hidden">已隐藏内容</button>
      <span class="spacer"></span>

    </div>`;
  }

  async function handleAction(action) {
    try { if (selectedNode?.isConnected && !['undo','redo'].includes(action)) await commitText(selectedNode,false); }
    catch(error){api.toast(error.message||'文字未保存');return;}

    if (action === "exit") exit();
    if (action === "font-down") adjustStyle("fontSize", -1, false);
    if (action === "font-up") adjustStyle("fontSize", 1, false);
    if (action === "line-down") adjustStyle("lineHeight", -1, false);
    if (action === "line-up") adjustStyle("lineHeight", 1, false);
    if (action === "reset-style") { adjustStyle("fontSize", 0, true); adjustStyle("lineHeight", 0, true); }
    if (action === "undo") undo();
    if (action === "redo") redo();
    if (action === "hidden") api.openHiddenModules();

  }

  global.WorkspaceEditor = { init, isEditing, enter, exit, afterRender, mutate, undo, redo, toolbar, handleAction, hideModule, restoreModule, hideAction, restoreAction, addImage, replaceImage, resizeImage, removeImage };
})(window);
