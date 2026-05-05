import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import { supabase } from "./supabase";

function extractYouTubeId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&]{11})/);
  return match ? match[1] : null;
}

const PLATFORMS = {
  youtube: { label: "YouTube", color: "#c0392b", bg: "#fff0ef", match: (url) => /youtube\.com|youtu\.be/.test(url) },
  instagram: { label: "Instagram", color: "#833ab4", bg: "#f5f0ff", match: (url) => /instagram\.com/.test(url) },
  x: { label: "X / Twitter", color: "#14171a", bg: "#f0f4f8", match: (url) => /twitter\.com|x\.com/.test(url) },
  image: { label: "Image", color: "#e67e22", bg: "#fdf2e9", match: (url) => /\.(jpeg|jpg|gif|png|webp|svg|bmp)(\?.*)?$/i.test(url) || url.startsWith('data:image/') },
  document: { label: "Document", color: "#2980b9", bg: "#ebf5fb", match: (url) => /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)(\?.*)?$/i.test(url) || url.includes("supabase.co") },
};

const DEFAULT_CATEGORIES = [
  "Coding / Dev", "Gym / Fitness", "Cooking", "Finance",
  "Design", "Music", "News", "Entertainment", "Travel", "Memes"
];

function detectPlatform(url) {
  for (const [key, val] of Object.entries(PLATFORMS)) {
    if (val.match(url)) return key;
  }
  return null;
}

async function fetchMetadata(url, platform) {
  if (platform === "image") {
    const fileName = url.split('/').pop().split('?')[0] || "Image File";
    return { title: fileName, author: "Direct Image", thumbnail: url };
  }
  try {
    if (platform === "youtube") {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (res.ok) { const d = await res.json(); return { title: d.title, author: d.author_name, thumbnail: d.thumbnail_url }; }
    }
    if (platform === "instagram") {
      const res = await fetch(`https://www.instagram.com/oembed/?url=${encodeURIComponent(url)}`);
      if (res.ok) { const d = await res.json(); return { title: d.title, author: d.author_name, thumbnail: d.thumbnail_url }; }
    }
  } catch (_) {}
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const d = await res.json();
      if (d.status === "success") {
        let thumbUrl = d.data.image?.url;
        if (thumbUrl && thumbUrl.startsWith("data:image")) thumbUrl = null;
        return { title: d.data.title || url, author: d.data.publisher || d.data.author || new URL(url).hostname.replace("www.", ""), thumbnail: thumbUrl || null };
      }
    }
  } catch (_) {}
  return { title: url, author: new URL(url).hostname.replace("www.", ""), thumbnail: null };
}

const STORAGE_KEY = "linkshelf_v1";
const SYNC_KEY = "linkshelf_sync";

function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        const parsed = JSON.parse(item);
        return {
          links: parsed.links || initialValue.links,
          categories: parsed.categories || initialValue.categories,
          theme: parsed.theme || initialValue.theme
        };
      }
      return initialValue;
    } catch (error) { return initialValue; }
  });
  return [storedValue, setStoredValue];
}

const Icon = ({ name, size = 16 }) => {
  const icons = {
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>,
    x: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>,
    trash: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
    external: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>,
    search: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>,
    loader: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    download: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>,
    upload: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>,
    play: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
    copy: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>,
    moon: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>,
    sun: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>,
    book: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>,
    grid: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>,
    star: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>,
    starFilled: <svg width={size} height={size} viewBox="0 0 24 24" fill="#f1c40f" stroke="#f1c40f" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>,
    restore: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>,
    sort: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="8" y1="12" x2="20" y2="12"></line><line x1="12" y1="18" x2="20" y2="18"></line></svg>,
    cloud: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>,
    cloudCheck: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M9 13l2 2 4-4"/></svg>,
    stats: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    note: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    archive: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
    file: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
  };
  return icons[name] || null;
};

export default function Linkshelf() {
  const [data, setData] = useLocalStorage(STORAGE_KEY, { links: [], categories: DEFAULT_CATEGORIES, theme: "light" });
  const links = data.links.map(l => ({ ...l, tags: l.tags || (l.category ? [l.category] : []), isDeleted: !!l.isDeleted, isPinned: !!l.isPinned, isRead: !!l.isRead, isArchived: !!l.isArchived, note: l.note || "" }));

  const [activeTab, setActiveTab] = useState("all");
  const [activeTags, setActiveTags] = useState([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [inputUrl, setInputUrl] = useState("");
  
  const [drawer, setDrawer] = useState(null); 
  const [drawerTags, setDrawerTags] = useState([]); 
  const [customCat, setCustomCat] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  
  const [videoModal, setVideoModal] = useState(null);
  const [readerModal, setReaderModal] = useState(null);
  
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkTagDrawer, setBulkTagDrawer] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [readFilter, setReadFilter] = useState("all"); // all | unread | read
  
  // Cloud Sync State
  const [syncDrawer, setSyncDrawer] = useState(false);
  const [syncConfig, setSyncConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || { token: "", gistId: "" }; } catch(e) { return { token: "", gistId: "" }; }
  });
  const [syncInput, setSyncInput] = useState(syncConfig.token);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle, syncing, success, error
  const syncTimeoutRef = useRef(null);

  const [toasts, setToasts] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef();
  const fileInputRef = useRef();
  const docInputRef = useRef();

  const isDark = data.theme === "dark";
  const th = {
    bg: isDark ? "#0F0F0F" : "#F5ECD7", header: isDark ? "#111111" : "#1E0F05", headerBrand: isDark ? "#FFFFFF" : "#F5ECD7",
    inputArea: isDark ? "#1A1A1A" : "#2C1A0E", inputBg: isDark ? "#2A2A2A" : "#1E0F05", inputBorder: isDark ? "#3A3A3A" : "#5C3D2A",
    inputText: isDark ? "#FFFFFF" : "#F5ECD7", border: isDark ? "#2A2A2A" : "#D4B896", borderLight: isDark ? "#2A2A2A" : "#E8D9C4",
    text: isDark ? "#FFFFFF" : "#1E0F05", textMuted: isDark ? "#888888" : "#9A7A60", textMuted2: isDark ? "#AAAAAA" : "#6B4F38",
    cardBg: isDark ? "#1A1A1A" : "white", badgeBgActive: isDark ? "#FFFFFF" : "#1E0F05", badgeTextActive: isDark ? "#0F0F0F" : "#F5ECD7",
    badgeBg: isDark ? "#2A2A2A" : "#D4B896", badgeText: isDark ? "#AAAAAA" : "#6B4F38", emptyText: isDark ? "#3A3A3A" : "#C9A882",
    btnBg: isDark ? "#FFFFFF" : "#1E0F05", btnText: isDark ? "#0F0F0F" : "#F5ECD7", danger: "#e74c3c", success: "#27ae60", selectRing: "#3498db"
  };

  const addToast = (message, type = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === "Escape") { setDrawer(null); setVideoModal(null); setReaderModal(null); setIsSelecting(false); setSyncDrawer(false); setShowStats(false); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // --- CLOUD SYNC LOGIC ---
  const triggerCloudSave = useCallback((newData, currentConfig) => {
    if (!currentConfig.token || !currentConfig.gistId) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    
    syncTimeoutRef.current = setTimeout(async () => {
      setSyncStatus("syncing");
      try {
        const res = await fetch(`https://api.github.com/gists/${currentConfig.gistId}`, {
          method: "PATCH",
          headers: { "Authorization": `token ${currentConfig.token}`, "Accept": "application/vnd.github.v3+json", "Content-Type": "application/json" },
          body: JSON.stringify({ files: { "linkshelf_data.json": { content: JSON.stringify(newData) } } })
        });
        if (res.ok) setSyncStatus("success"); else setSyncStatus("error");
      } catch (e) { setSyncStatus("error"); }
      setTimeout(() => setSyncStatus("idle"), 3000);
    }, 2000);
  }, []);

  // Initial Load from Cloud
  useEffect(() => {
    const loadFromCloud = async () => {
      if (!syncConfig.token || !syncConfig.gistId) return;
      setSyncStatus("syncing");
      try {
        const res = await fetch(`https://api.github.com/gists/${syncConfig.gistId}`, { headers: { "Authorization": `token ${syncConfig.token}` } });
        if (res.ok) {
          const gist = await res.json();
          if (gist.files["linkshelf_data.json"]) {
            const cloudData = JSON.parse(gist.files["linkshelf_data.json"].content);
            setData(cloudData); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudData));
            addToast("Synced from cloud!");
            setSyncStatus("success");
          }
        }
      } catch(e) { setSyncStatus("error"); }
      setTimeout(() => setSyncStatus("idle"), 3000);
    };
    loadFromCloud();
  }, []);

  const handleConnectSync = async () => {
    if (!syncInput.trim()) {
      localStorage.removeItem(SYNC_KEY); setSyncConfig({ token: "", gistId: "" }); addToast("Cloud Sync disabled."); setSyncDrawer(false); return;
    }
    setSyncStatus("syncing");
    try {
      // Find existing gist
      let res = await fetch("https://api.github.com/gists", { headers: { "Authorization": `token ${syncInput.trim()}` } });
      if (!res.ok) throw new Error("Invalid token");
      const gists = await res.json();
      const existing = gists.find(g => g.files["linkshelf_data.json"]);

      let newConfig = { token: syncInput.trim(), gistId: "" };
      if (existing) {
        newConfig.gistId = existing.id;
        // Merge cloud data to local immediately
        const gistRes = await fetch(`https://api.github.com/gists/${existing.id}`, { headers: { "Authorization": `token ${newConfig.token}` } });
        const gistData = await gistRes.json();
        const cloudData = JSON.parse(gistData.files["linkshelf_data.json"].content);
        setData(cloudData); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudData));
        addToast("Connected! Restored from cloud.");
      } else {
        // Create new gist with current local data
        const createRes = await fetch("https://api.github.com/gists", {
          method: "POST",
          headers: { "Authorization": `token ${newConfig.token}`, "Accept": "application/vnd.github.v3+json", "Content-Type": "application/json" },
          body: JSON.stringify({ description: "Linkshelf Cloud Sync Data", public: false, files: { "linkshelf_data.json": { content: JSON.stringify(data) } } })
        });
        const created = await createRes.json();
        newConfig.gistId = created.id;
        addToast("Connected! Backed up to cloud.");
      }
      
      localStorage.setItem(SYNC_KEY, JSON.stringify(newConfig));
      setSyncConfig(newConfig);
      setSyncStatus("success");
      setTimeout(() => { setSyncStatus("idle"); setSyncDrawer(false); }, 1500);
    } catch (e) {
      addToast("Failed to connect. Check token.", "error");
      setSyncStatus("error");
    }
  };

  const persist = (updates) => {
    setData(d => {
      const newFullData = { ...d, ...updates };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newFullData));
      triggerCloudSave(newFullData, syncConfig);
      return newFullData;
    });
  };

  // -------------------------

  const toggleTheme = () => persist({ theme: isDark ? "light" : "dark" });

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `linkshelf_backup_${new Date().toISOString().split("T")[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
    addToast("Backup exported successfully!");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setUploadProgress(50); // Show loading state
    
    // Clean filename for Supabase storage
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
    const filePath = `${Date.now()}_${cleanFileName}`;
    
    const { error } = await supabase.storage
      .from('Docs linkshelf')
      .upload(filePath, file);
      
    if (error) {
      console.error(error);
      addToast("Upload failed", "error");
      setUploadProgress(null);
      return;
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('Docs linkshelf')
      .getPublicUrl(filePath);
      
    setUploadProgress(null);
    const platform = "document";
    setDrawer({ url: publicUrl, platform, meta: { title: file.name, author: "My Files", thumbnail: null }, loading: false, note: "" });
    setDrawerTags([]);
    e.target.value = null;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    // Only set false if we leave the main window, not child elements
    if (e.clientY <= 0 || e.clientX <= 0 || (e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
      setIsDragging(false);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload({ target: { files: e.dataTransfer.files } });
    }
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target.result;
      // Detect browser bookmark HTML (Netscape format)
      if (raw.trim().startsWith("<!DOCTYPE NETSCAPE") || raw.includes("<DL>")) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(raw, "text/html");
        const anchors = Array.from(doc.querySelectorAll("a"));
        if (!anchors.length) { addToast("No bookmarks found.", "error"); return; }
        const imported = anchors.map(a => ({
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          url: a.href, platform: detectPlatform(a.href),
          title: a.textContent.trim() || a.href,
          author: "", thumbnail: null, tags: [], note: "",
          savedAt: new Date().toISOString(), isPinned: false, isDeleted: false, isRead: false, isArchived: false
        }));
        persist({ links: [...imported, ...links] });
        addToast(`Imported ${imported.length} bookmarks!`);
      } else {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.links && parsed.categories) { persist(parsed); addToast("Backup imported successfully!"); }
        } catch (err) { addToast("Failed to read file.", "error"); }
      }
    };
    reader.readAsText(file); e.target.value = null;
  };

  const handlePaste = async (url) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const duplicate = links.find(l => !l.isDeleted && !l.isArchived && l.url.trim() === trimmed);
    if (duplicate) { addToast("Already on your shelf!", "error"); return; }
    const platform = detectPlatform(trimmed);
    setDrawer({ url: trimmed, platform, meta: null, loading: true, note: "" });
    setInputUrl("");
    const meta = await fetchMetadata(trimmed, platform);
    setDrawer({ url: trimmed, platform, meta, loading: false, note: "" });
    setDrawerTags([]);
  };

  const handleSave = () => {
    if (!drawer) return;
    const finalTags = new Set(drawerTags);
    if (addingCustom && customCat.trim()) finalTags.add(customCat.trim());
    const tagsArray = Array.from(finalTags);
    const newCategories = new Set(data.categories); tagsArray.forEach(t => newCategories.add(t));

    if (drawer.editingId) {
      persist({
        links: links.map(l => l.id === drawer.editingId ? {
          ...l, title: drawer.meta?.title || drawer.url, author: drawer.meta?.author || "",
          thumbnail: drawer.meta?.thumbnail || null, tags: tagsArray, note: drawer.note || ""
        } : l), categories: Array.from(newCategories)
      });
      addToast("Link updated!");
    } else {
      persist({ links: [{
        id: Date.now().toString(), url: drawer.url, platform: drawer.platform,
        title: drawer.meta?.title || drawer.url, author: drawer.meta?.author || "",
        thumbnail: drawer.meta?.thumbnail || null, tags: tagsArray, note: drawer.note || "",
        savedAt: new Date().toISOString(), isPinned: false, isDeleted: false, isRead: false, isArchived: false
      }, ...links], categories: Array.from(newCategories) });
      addToast("Link saved to shelf!");
    }
    setDrawer(null); setDrawerTags([]); setCustomCat(""); setAddingCustom(false);
  };

  const togglePin = (id) => { persist({ links: links.map(l => l.id === id ? { ...l, isPinned: !l.isPinned } : l) }); };
  const toggleRead = (id) => { persist({ links: links.map(l => l.id === id ? { ...l, isRead: !l.isRead } : l) }); };
  const archiveLink = (id) => { persist({ links: links.map(l => l.id === id ? { ...l, isArchived: true } : l) }); addToast("Archived!"); };
  const unarchiveLink = (id) => { persist({ links: links.map(l => l.id === id ? { ...l, isArchived: false } : l) }); addToast("Unarchived!"); };
  const moveToTrash = (id) => { persist({ links: links.map(l => l.id === id ? { ...l, isDeleted: true } : l) }); addToast("Moved to trash"); };
  const restoreLink = (id) => { persist({ links: links.map(l => l.id === id ? { ...l, isDeleted: false } : l) }); addToast("Restored!"); };
  const permanentlyDelete = (id) => { persist({ links: links.filter(l => l.id !== id) }); addToast("Permanently deleted", "error"); };

  const handleBulkAction = (action) => {
    if (action === "trash") {
      persist({ links: links.map(l => selectedIds.has(l.id) ? { ...l, isDeleted: true } : l) }); addToast(`Moved ${selectedIds.size} links to trash`);
    } else if (action === "restore") {
      persist({ links: links.map(l => selectedIds.has(l.id) ? { ...l, isDeleted: false } : l) }); addToast(`Restored ${selectedIds.size} links`);
    } else if (action === "delete") {
      persist({ links: links.filter(l => !selectedIds.has(l.id)) }); addToast(`Permanently deleted ${selectedIds.size} links`, "error");
    }
    setIsSelecting(false); setSelectedIds(new Set());
  };

  const handleBulkTagSave = () => {
    const finalTags = new Set(drawerTags); if (addingCustom && customCat.trim()) finalTags.add(customCat.trim());
    const tagsArray = Array.from(finalTags);
    const newCategories = new Set(data.categories); tagsArray.forEach(t => newCategories.add(t));
    persist({ links: links.map(l => selectedIds.has(l.id) ? { ...l, tags: tagsArray } : l), categories: Array.from(newCategories) });
    addToast(`Updated tags for ${selectedIds.size} links!`);
    setBulkTagDrawer(false); setIsSelecting(false); setSelectedIds(new Set()); setDrawerTags([]); setCustomCat("");
  };

  const handleRead = async (url) => {
    // Sites that block scrapers — open directly instead of wasting time
    const BLOCKED_DOMAINS = [
      "twitter.com", "x.com", "reddit.com", "wsj.com", "ft.com",
      "nytimes.com", "bloomberg.com", "economist.com", "instagram.com",
    ];
    try {
      const hostname = new URL(url).hostname.replace("www.", "");
      if (BLOCKED_DOMAINS.some(d => hostname.includes(d))) {
        addToast("This site blocks reading — opening in browser.", "error");
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    } catch (_) {}

    setReaderModal({ url, loading: true, title: "", html: "" });

    const fetchWithTimeout = (fetchUrl, ms = 9000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      return fetch(fetchUrl, { signal: controller.signal }).finally(() => clearTimeout(timer));
    };

    const proxies = [
      { url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, json: true },
      { url: `https://corsproxy.io/?url=${encodeURIComponent(url)}`, json: false },
      { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, json: false },
    ];

    let html = null;
    for (const proxy of proxies) {
      try {
        const res = await fetchWithTimeout(proxy.url);
        if (!res.ok) continue;
        const text = proxy.json ? (await res.json()).contents : await res.text();
        if (text && text.length > 200) { html = text; break; }
      } catch (_) { /* try next */ }
    }

    if (!html) {
      setReaderModal(null);
      addToast("Can't fetch — opening in browser instead.", "error");
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const base = doc.createElement("base");
      base.href = url;
      doc.head.prepend(base);
      const article = new Readability(doc).parse();
      if (article && article.content) {
        setReaderModal({ url, loading: false, title: article.title, html: DOMPurify.sanitize(article.content) });
      } else {
        setReaderModal(null);
        addToast("Couldn't extract text — opening in browser.", "error");
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setReaderModal(null);
      addToast("Failed to parse article.", "error");
    }
  };

  let processed = links.filter(l => {
    if (activeTab === "trash") return l.isDeleted;
    if (activeTab === "archive") return l.isArchived && !l.isDeleted;
    if (l.isDeleted || l.isArchived) return false;
    const matchTab = activeTab === "all" || l.platform === activeTab;
    const matchSearch = !search || l.title.toLowerCase().includes(search.toLowerCase()) || l.author.toLowerCase().includes(search.toLowerCase());
    const matchTags = activeTags.length === 0 || activeTags.some(t => l.tags.includes(t));
    const matchRead = readFilter === "all" || (readFilter === "read" && l.isRead) || (readFilter === "unread" && !l.isRead);
    return matchTab && matchTags && matchSearch && matchRead;
  });

  processed.sort((a, b) => {
    if (activeTab !== "trash") {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
    }
    if (sortBy === "newest") return new Date(b.savedAt) - new Date(a.savedAt);
    if (sortBy === "oldest") return new Date(a.savedAt) - new Date(b.savedAt);
    if (sortBy === "az") return a.title.localeCompare(b.title);
    if (sortBy === "za") return b.title.localeCompare(a.title);
    if (sortBy === "unread") return (a.isRead ? 1 : 0) - (b.isRead ? 1 : 0);
    return 0;
  });

  const tabCounts = {
    all: links.filter(l => !l.isDeleted && !l.isArchived).length,
    document: links.filter(l => !l.isDeleted && !l.isArchived && l.platform === "document").length,
    youtube: links.filter(l => !l.isDeleted && !l.isArchived && l.platform === "youtube").length,
    instagram: links.filter(l => !l.isDeleted && !l.isArchived && l.platform === "instagram").length,
    x: links.filter(l => !l.isDeleted && !l.isArchived && l.platform === "x").length,
    archive: links.filter(l => l.isArchived && !l.isDeleted).length,
    trash: links.filter(l => l.isDeleted).length
  };
  const unreadCount = links.filter(l => !l.isDeleted && !l.isArchived && !l.isRead).length;

  const visibleCategories = [...new Set(links.filter(l => !l.isDeleted && !l.isArchived).flatMap(l => l.tags))];

  return (
    <div 
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      style={{ minHeight: "100vh", background: th.bg, fontFamily: "'DM Sans', sans-serif", transition: "background 0.3s ease", paddingBottom: isSelecting ? "80px" : 0 }}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
            style={{ position: "fixed", inset: 0, zIndex: 9999, background: isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: th.text, border: `4px dashed ${th.textMuted}`, padding: "64px", borderRadius: 32, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ color: th.textMuted, opacity: 0.5 }}><Icon name="upload" size={64} /></div>
              <h2 style={{ fontFamily: "'Anton', sans-serif", fontSize: 48, marginTop: 16, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>DROP TO UPLOAD</h2>
              <p style={{ fontSize: 18, color: th.textMuted2, margin: 0 }}>PDFs, Docs, Spreadsheets, and Images</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <link href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* ── HEADER ── */}
      <header className="mobile-header" style={{
        background: isDark ? "rgba(17,17,17,0.75)" : "rgba(30,15,5,0.85)", padding: "0 2rem", display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 64, position: "sticky", top: 0, zIndex: 100, borderBottom: `1px solid ${th.borderLight}`, transition: "background 0.3s ease",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)"
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="brand-text" style={{ fontFamily: "'Anton', sans-serif", fontSize: 26, color: th.headerBrand, letterSpacing: 1, textTransform: "uppercase" }}>Linkshelf</span>
          <span className="subtitle" style={{ fontSize: 12, color: th.textMuted, fontWeight: 500 }}>personal curator</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="header-icons" style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Icon name="sort" size={14} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ appearance: "none", background: "none", border: "none", color: th.textMuted, fontSize: 13, outline: "none", paddingLeft: 6, cursor: "pointer", fontWeight: 500 }}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="az">A to Z</option>
                <option value="za">Z to A</option>
                <option value="unread">Unread First</option>
              </select>
            </div>
            <div className="header-divider" style={{ width: 1, height: 16, background: th.border, margin: "auto 8px" }}></div>
            
            <button onClick={() => setShowStats(true)} title="Stats" style={{ background: "none", border: "none", color: th.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Icon name="stats" size={16} />
            </button>
            <button onClick={() => setSyncDrawer(true)} title="Cloud Sync" style={{ background: "none", border: "none", color: syncConfig.token ? "#D4924A" : th.textMuted, cursor: "pointer", display: "flex", alignItems: "center", position: "relative" }}>
              <Icon name={syncConfig.token ? "cloudCheck" : "cloud"} size={16} />
              {syncStatus === "syncing" && <span style={{ position: "absolute", top: -2, right: -4, width: 6, height: 6, background: "#3498db", borderRadius: "50%", animation: "pulse 1s infinite" }} />}
              {syncStatus === "error" && <span style={{ position: "absolute", top: -2, right: -4, width: 6, height: 6, background: th.danger, borderRadius: "50%" }} />}
            </button>
            <style>{`@keyframes pulse { 0% { transform: scale(0.8); opacity: 0.5; } 50% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(0.8); opacity: 0.5; } }`}</style>

            <button onClick={() => { setIsSelecting(!isSelecting); setSelectedIds(new Set()); }} title="Bulk Select" style={{ background: isSelecting ? th.text : "none", borderRadius: 8, padding: 6, border: "none", color: isSelecting ? th.bg : th.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Icon name="grid" size={16} />
            </button>
            <button onClick={toggleTheme} title="Toggle Theme" style={{ background: "none", border: "none", color: th.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Icon name={isDark ? "sun" : "moon"} size={16} />
            </button>
            <button onClick={handleExport} title="Export Backup" style={{ background: "none", border: "none", color: th.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Icon name="download" size={16} />
            </button>
            <label title="Import Backup" style={{ color: th.textMuted, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <Icon name="upload" size={16} />
              <input type="file" ref={fileInputRef} accept=".json,.html,text/html" onChange={handleImport} style={{ display: "none" }} />
            </label>
          </div>
        </div>
      </header>

      {/* ── INPUT BAR ── */}
      <div className="mobile-input-area" style={{ background: th.inputArea, padding: "1.5rem 2rem", transition: "background 0.3s ease" }}>
        <div className="mobile-input-wrapper" style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 10 }}>
          <input
            ref={inputRef} value={inputUrl} onChange={e => setInputUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePaste(inputUrl)}
            placeholder="Paste a link (Cmd/Ctrl + K)…"
            style={{
              flex: 1, padding: "14px 18px", borderRadius: 12, border: `1.5px solid ${th.inputBorder}`, background: th.inputBg,
              color: th.inputText, fontSize: 15, outline: "none", fontFamily: "'DM Sans', sans-serif"
            }} />
          <div className="mobile-action-buttons" style={{ display: "flex", gap: 10 }}>
            <button onClick={() => handlePaste(inputUrl)} style={{ background: "#D4924A", border: "none", borderRadius: 12, padding: "0 24px", cursor: "pointer", color: "#1E0F05", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6, transition: "transform 0.1s" }} onMouseDown={e => e.currentTarget.style.transform="scale(0.96)"} onMouseUp={e => e.currentTarget.style.transform="scale(1)"} onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}>
              <Icon name="plus" size={18} /> Add
            </button>
            
            <label style={{ background: th.cardBg, border: `1.5px solid ${th.border}`, borderRadius: 12, padding: "0 20px", cursor: "pointer", color: th.text, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6, position: "relative", overflow: "hidden", transition: "transform 0.1s" }} onMouseDown={e => e.currentTarget.style.transform="scale(0.96)"} onMouseUp={e => e.currentTarget.style.transform="scale(1)"} onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}>
              <Icon name={uploadProgress !== null ? "loader" : "file"} size={18} /> 
              {uploadProgress !== null ? `${Math.round(uploadProgress)}%` : "Upload"}
              {uploadProgress !== null && <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, background: "#D4924A", width: `${uploadProgress}%` }} />}
              <input type="file" ref={docInputRef} onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="mobile-tabs-container" style={{ background: th.bg, borderBottom: `1.5px solid ${th.border}`, padding: "0 2rem" }}>
        <div className="scroll-hide" style={{ maxWidth: 960, margin: "0 auto", display: "flex", gap: 0, overflowX: "auto" }}>
          {[["all", "All"], ["document", "Docs"], ["youtube", "YouTube"], ["instagram", "Instagram"], ["x", "X / Twitter"], ["archive", "Archive"], ["trash", "Trash"]].map(([key, label]) => (
            <button key={key} onClick={() => { setActiveTab(key); setActiveTags([]); }}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "14px 20px", fontSize: 13, fontWeight: 600,
                color: activeTab === key ? th.text : th.textMuted, borderBottom: activeTab === key ? `2.5px solid ${th.text}` : "2.5px solid transparent",
                fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 6, transition: "color 0.2s"
              }}>
              {label}
              <span style={{ fontSize: 11, background: activeTab === key ? th.badgeBgActive : th.badgeBg, color: activeTab === key ? th.badgeTextActive : th.badgeText, borderRadius: 99, padding: "1px 7px" }}>{tabCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── FILTERS ── */}
      {activeTab !== "trash" && activeTab !== "archive" && (
        <div className="mobile-filters-container" style={{ maxWidth: 960, margin: "0 auto", padding: "1rem 2rem 0" }}>
          <div className="mobile-filters-scroll" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", marginRight: 4 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: th.textMuted }}><Icon name="search" size={14} /></span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: `1px solid ${th.border}`, background: th.cardBg, color: th.text, fontSize: 13, outline: "none", width: 160, fontFamily: "'DM Sans', sans-serif" }} />
            </div>
            {["all", "unread", "read"].map(f => (
              <button key={f} onClick={() => setReadFilter(f)} style={{ padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 500, border: readFilter === f ? `1.5px solid #D4924A` : `1px solid ${th.border}`, background: readFilter === f ? "#D4924A" : th.cardBg, color: readFilter === f ? "#1E0F05" : th.textMuted2, cursor: "pointer" }}>
                {f === "all" ? `All${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}` : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <div style={{ width: 1, height: 16, background: th.border }} />
            <button onClick={() => setActiveTags([])} style={{
              padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 500, border: activeTags.length === 0 ? `1.5px solid ${th.text}` : `1px solid ${th.border}`,
              background: activeTags.length === 0 ? th.text : th.cardBg, color: activeTags.length === 0 ? th.bg : th.textMuted2, cursor: "pointer"
            }}>All topics</button>
            {visibleCategories.map(cat => {
              const isActive = activeTags.includes(cat);
              return (
                <button
                  key={cat} className="topic-pill" onClick={() => setActiveTags(p => p.includes(cat) ? p.filter(t => t !== cat) : [...p, cat])}
                  style={{ padding: "6px 14px", borderRadius: 99, border: `1px solid ${isActive ? "transparent" : th.border}`, background: isActive ? th.badgeBgActive : th.badgeBg, color: isActive ? th.badgeTextActive : th.badgeText, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}
                >
                  {isActive && <Icon name="check" size={10} />} {cat}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── GRID ── */}
      <main className="mobile-main" style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 2rem 4rem" }}>
        {processed.length === 0 ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ textAlign: "center", padding: "6rem 1rem", color: th.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ background: th.cardBg, padding: 24, borderRadius: "50%", border: `1px solid ${th.borderLight}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 30px rgba(0,0,0,0.05)", marginBottom: 12 }}>
              <Icon name={activeTab === "trash" ? "trash" : "archive"} size={32} />
            </div>
            <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 36, textTransform: "uppercase", color: th.emptyText, letterSpacing: 1 }}>{activeTab === "trash" ? "Trash is empty" : "Empty shelf"}</div>
            <div style={{ fontSize: 16, maxWidth: 300, lineHeight: 1.5 }}>{activeTab === "trash" ? "Deleted items will appear here." : "Paste a link above or upload a document to start curating."}</div>
          </motion.div>
        ) : (
          <motion.div layout className="grid-container" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            <AnimatePresence>
              {processed.map(link => (
                <LinkCard 
                  key={link.id} link={link} th={th} isSelecting={isSelecting} isSelected={selectedIds.has(link.id)}
                  onSelect={() => setSelectedIds(p => { const n = new Set(p); n.has(link.id) ? n.delete(link.id) : n.add(link.id); return n; })}
                  onDelete={() => moveToTrash(link.id)} onEdit={(l) => { setDrawer({ editingId: l.id, url: l.url, platform: l.platform, meta: { title: l.title, author: l.author, thumbnail: l.thumbnail }, note: l.note || "", loading: false }); setDrawerTags([...l.tags]); setAddingCustom(false); setCustomCat(""); }}
                  onWatch={setVideoModal} onRead={handleRead} onCopy={() => { navigator.clipboard.writeText(link.url); addToast("Copied!"); }}
                  onTogglePin={() => togglePin(link.id)} onToggleRead={() => toggleRead(link.id)}
                  onArchive={() => archiveLink(link.id)} onUnarchive={() => unarchiveLink(link.id)}
                  onRestore={() => restoreLink(link.id)} onPermDelete={() => permanentlyDelete(link.id)}
                  isTrash={activeTab === "trash"} isArchive={activeTab === "archive"}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

      {/* ── BULK ACTION BAR ── */}
      <AnimatePresence>
        {isSelecting && (
          <motion.div className="mobile-bulk-bar" initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
            style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 150, background: th.cardBg, border: `1.5px solid ${th.text}`, borderRadius: 99, padding: "10px 20px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: th.text }}>{selectedIds.size} selected</span>
            <div style={{ width: 1, height: 20, background: th.border }}></div>
            {activeTab === "trash" ? (
              <>
                <button onClick={() => handleBulkAction("restore")} disabled={!selectedIds.size} style={{ background: "none", border: "none", color: th.text, fontWeight: 600, cursor: selectedIds.size ? "pointer" : "not-allowed", opacity: selectedIds.size ? 1 : 0.5 }}>Restore</button>
                <button onClick={() => handleBulkAction("delete")} disabled={!selectedIds.size} style={{ background: "none", border: "none", color: th.danger, fontWeight: 600, cursor: selectedIds.size ? "pointer" : "not-allowed", opacity: selectedIds.size ? 1 : 0.5 }}>Erase</button>
              </>
            ) : (
              <>
                <button onClick={() => { setDrawerTags([]); setBulkTagDrawer(true); }} disabled={!selectedIds.size} style={{ background: "none", border: "none", color: th.text, fontWeight: 600, cursor: selectedIds.size ? "pointer" : "not-allowed", opacity: selectedIds.size ? 1 : 0.5 }}>Edit Tags</button>
                <button onClick={() => handleBulkAction("trash")} disabled={!selectedIds.size} style={{ background: "none", border: "none", color: th.danger, fontWeight: 600, cursor: selectedIds.size ? "pointer" : "not-allowed", opacity: selectedIds.size ? 1 : 0.5 }}>Move to Trash</button>
              </>
            )}
            <button onClick={() => { setIsSelecting(false); setSelectedIds(new Set()); }} style={{ background: "none", border: "none", color: th.textMuted, cursor: "pointer" }}><Icon name="x" size={16} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(drawer || bulkTagDrawer || syncDrawer) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => { if (!drawer?.loading && syncStatus !== "syncing") { setDrawer(null); setBulkTagDrawer(false); setSyncDrawer(false); } }}>
            <motion.div className="mobile-drawer-content" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }}
              onClick={e => e.stopPropagation()} style={{ background: th.bg, borderRadius: "20px 20px 0 0", borderTop: `1px solid ${th.border}`, width: "100%", maxWidth: 560, padding: "2rem", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 20, textTransform: "uppercase", color: th.text }}>{syncDrawer ? "Cloud Sync" : (bulkTagDrawer ? `Edit Tags (${selectedIds.size})` : (drawer?.editingId ? "Edit Link" : "Confirm & Save"))}</div>
                </div>
                <button onClick={() => { setDrawer(null); setBulkTagDrawer(false); setSyncDrawer(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: th.textMuted }}><Icon name="x" size={20} /></button>
              </div>
              
              {/* CLOUD SYNC DRAWER CONTENT */}
              {syncDrawer && (
                <div>
                  <p style={{ fontSize: 13, color: th.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
                    Securely sync your links across PC and Phone for free using a private <b>GitHub Gist</b>.
                  </p>
                  
                  <div style={{ background: th.cardBg, border: `1px solid ${th.border}`, padding: 16, borderRadius: 12, marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: th.text, marginBottom: 8 }}>1. Generate a GitHub Token</div>
                    <div style={{ fontSize: 12, color: th.textMuted, lineHeight: 1.5 }}>
                      Go to GitHub Settings &rarr; Developer Settings &rarr; Personal access tokens (Classic). Generate a new token and select <b>ONLY</b> the <code>gist</code> checkbox.
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, color: th.text, marginBottom: 8 }}>2. Paste Token Here (on both devices)</div>
                  <input type="password" value={syncInput} onChange={e => setSyncInput(e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: `1.5px solid ${th.inputBorder}`, background: th.inputBg, color: th.inputText, fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif", marginBottom: 16, boxSizing: "border-box" }} />
                  
                  <button onClick={handleConnectSync} disabled={syncStatus === "syncing"} style={{ width: "100%", padding: "13px", background: th.btnBg, color: th.btnText, border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: syncStatus === "syncing" ? "not-allowed" : "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, opacity: syncStatus === "syncing" ? 0.7 : 1 }}>
                    {syncStatus === "syncing" ? <Icon name="loader" size={16} /> : <Icon name={syncInput ? "cloud" : "x"} size={16} />}
                    {syncStatus === "syncing" ? "Connecting..." : (syncInput ? "Connect & Sync" : "Disable Sync")}
                  </button>
                  
                  {syncConfig.gistId && (
                    <div style={{ marginTop: 16, fontSize: 11, color: th.textMuted, textAlign: "center" }}>
                      Connected to Gist ID: <code>{syncConfig.gistId.slice(0,8)}...</code>
                    </div>
                  )}
                </div>
              )}

              {/* NORMAL EDIT DRAWER CONTENT */}
              {!syncDrawer && drawer?.loading ? (
                <div style={{ textAlign: "center", padding: "2rem 0", color: th.textMuted }}><Icon name="loader" size={28} /></div>
              ) : (!syncDrawer && (
                <>
                  {!bulkTagDrawer && (
                    <>
                      <div style={{ position: "relative", marginBottom: 12 }}>
                        {drawer.meta?.thumbnail ? <img src={drawer.meta.thumbnail} alt="" style={{ width: "100%", borderRadius: 10, maxHeight: 160, objectFit: "cover" }} /> : <div style={{ width: "100%", height: 100, borderRadius: 10, background: th.borderLight, display: "flex", alignItems: "center", justifyContent: "center", color: th.textMuted, fontSize: 12 }}>No image</div>}
                        <input placeholder="Custom Image URL..." value={drawer.meta?.thumbnail || ""} onChange={e => setDrawer({ ...drawer, meta: { ...drawer.meta, thumbnail: e.target.value }})} style={{ position: "absolute", bottom: 8, left: 8, right: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(0,0,0,0.1)", background: "rgba(255,255,255,0.9)", color: "#000", fontSize: 11, outline: "none", fontFamily: "'DM Sans', sans-serif" }} />
                      </div>
                      <input value={drawer.meta?.title || ""} onChange={e => setDrawer({ ...drawer, meta: { ...drawer.meta, title: e.target.value }})} style={{ width: "100%", fontSize: 15, fontWeight: 600, color: th.text, marginBottom: 4, background: "transparent", border: "none", borderBottom: `1px dashed ${th.border}`, outline: "none", paddingBottom: 2, fontFamily: "'DM Sans', sans-serif" }} />
                      <input value={drawer.meta?.author || ""} onChange={e => setDrawer({ ...drawer, meta: { ...drawer.meta, author: e.target.value }})} style={{ width: "100%", fontSize: 12, color: th.textMuted, marginBottom: 16, background: "transparent", border: "none", borderBottom: `1px dashed ${th.border}`, outline: "none", paddingBottom: 2, fontFamily: "'DM Sans', sans-serif" }} />
                    </>
                  )}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {data.categories.map(cat => {
                        const isActive = drawerTags.includes(cat);
                        return <button key={cat} onClick={() => setDrawerTags(p => p.includes(cat) ? p.filter(t => t !== cat) : [...p, cat])} style={{ padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 500, border: isActive ? `1.5px solid ${th.text}` : `1px solid ${th.border}`, background: isActive ? th.text : "transparent", color: isActive ? th.bg : th.textMuted2, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>{isActive && <Icon name="check" size={11} />} {cat}</button>;
                      })}
                      <button onClick={() => setAddingCustom(true)} style={{ padding: "6px 14px", borderRadius: 99, fontSize: 12, border: addingCustom ? "1.5px solid #D4924A" : `1px dashed ${th.border}`, color: "#D4924A", background: "none", cursor: "pointer" }}>+ New tag</button>
                    </div>
                  </div>
                  {addingCustom && <input value={customCat} onChange={e => setCustomCat(e.target.value)} placeholder="e.g. AI, Startup..." autoFocus style={{ width: "100%", padding: "9px 12px", borderRadius: 8, marginTop: 10, border: "1.5px solid #D4924A", background: th.cardBg, color: th.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />}
                  {!bulkTagDrawer && <><div style={{ fontSize: 12, fontWeight: 600, color: th.textMuted, marginTop: 16, marginBottom: 6 }}>Personal Note</div><textarea value={drawer?.note || ""} onChange={e => setDrawer({ ...drawer, note: e.target.value })} placeholder="Add a note to remember why you saved this..." rows={3} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${th.border}`, background: th.cardBg, color: th.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} /></>}
                  <button onClick={bulkTagDrawer ? handleBulkTagSave : handleSave} style={{ marginTop: 20, width: "100%", padding: "13px", background: th.btnBg, color: th.btnText, border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{bulkTagDrawer ? "Apply Tags" : "Save"}</button>
                </>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── STATS MODAL ── */}
      <AnimatePresence>
        {showStats && (() => {
          const total = links.filter(l => !l.isDeleted && !l.isArchived).length;
          const readCount = links.filter(l => !l.isDeleted && !l.isArchived && l.isRead).length;
          const platformStats = Object.entries(PLATFORMS).map(([k, v]) => ({ label: v.label, count: links.filter(l => !l.isDeleted && !l.isArchived && l.platform === k).length, color: v.color })).filter(p => p.count > 0);
          const tagCounts = {}; links.filter(l => !l.isDeleted && !l.isArchived).forEach(l => l.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
          const topTags = Object.entries(tagCounts).sort((a,b) => b[1]-a[1]).slice(0,6);
          const maxTag = topTags[0]?.[1] || 1;
          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowStats(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} onClick={e => e.stopPropagation()}
                style={{ background: th.bg, borderRadius: 20, padding: "2rem", width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", border: `1px solid ${th.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 22, textTransform: "uppercase", color: th.text }}>Shelf Stats</span>
                  <button onClick={() => setShowStats(false)} style={{ background: "none", border: "none", cursor: "pointer", color: th.textMuted }}><Icon name="x" size={20} /></button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
                  {[{ label: "Total", val: total }, { label: "Read", val: readCount }, { label: "Unread", val: total - readCount }].map(s => (
                    <div key={s.label} style={{ background: th.cardBg, borderRadius: 12, padding: "14px", textAlign: "center", border: `1px solid ${th.border}` }}>
                      <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 28, color: th.text }}>{s.val}</div>
                      <div style={{ fontSize: 11, color: th.textMuted, fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {total > 0 && <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: th.textMuted }}>READ PROGRESS</div>}
                {total > 0 && <div style={{ height: 8, background: th.borderLight, borderRadius: 99, marginBottom: 24, overflow: "hidden" }}><motion.div initial={{ width: 0 }} animate={{ width: `${Math.round((readCount/total)*100)}%` }} transition={{ duration: 0.8 }} style={{ height: "100%", background: "#27ae60", borderRadius: 99 }} /></div>}
                {platformStats.length > 0 && <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: th.textMuted }}>BY PLATFORM</div>}
                {platformStats.map(p => <div key={p.label} style={{ marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span style={{ color: th.text }}>{p.label}</span><span style={{ fontWeight: 600, color: th.text }}>{p.count}</span></div><div style={{ height: 5, background: th.borderLight, borderRadius: 99 }}><motion.div initial={{ width: 0 }} animate={{ width: `${Math.round((p.count/total)*100)}%` }} transition={{ duration: 0.6 }} style={{ height: "100%", background: p.color, borderRadius: 99 }} /></div></div>)}
                {topTags.length > 0 && <div style={{ margin: "16px 0 8px", fontSize: 11, fontWeight: 600, color: th.textMuted }}>TOP TAGS</div>}
                {topTags.map(([tag, cnt]) => <div key={tag} style={{ marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span style={{ color: th.text }}>{tag}</span><span style={{ fontWeight: 600, color: th.text }}>{cnt}</span></div><div style={{ height: 5, background: th.borderLight, borderRadius: 99 }}><motion.div initial={{ width: 0 }} animate={{ width: `${Math.round((cnt/maxTag)*100)}%` }} transition={{ duration: 0.6 }} style={{ height: "100%", background: "#D4924A", borderRadius: 99 }} /></div></div>)}
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {videoModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }} onClick={() => setVideoModal(null)}>
            <div style={{ position: "absolute", top: 20, right: 20 }}><button onClick={() => setVideoModal(null)} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", padding: 10, cursor: "pointer", color: "white" }}><Icon name="x" size={24} /></button></div>
            <motion.iframe initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} src={`https://www.youtube.com/embed/${videoModal}?autoplay=1`} style={{ width: "100%", maxWidth: 1000, aspectRatio: "16/9", borderRadius: 12, border: "none" }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {readerModal && (
          <motion.div className="mobile-reader-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", inset: 0, background: th.bg, zIndex: 300, overflowY: "auto", padding: "4rem 2rem" }}>
            <div style={{ position: "fixed", top: 20, right: 20, zIndex: 310 }}><button onClick={() => setReaderModal(null)} style={{ background: th.cardBg, border: `1px solid ${th.border}`, borderRadius: "50%", padding: 10, cursor: "pointer", color: th.text, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}><Icon name="x" size={24} /></button></div>
            <div className="mobile-reader-content" style={{ maxWidth: 680, margin: "0 auto", background: th.cardBg, padding: "3rem", borderRadius: 16, boxShadow: "0 20px 40px rgba(0,0,0,0.05)", border: `1px solid ${th.borderLight}` }}>
              {readerModal.loading ? (
                <div style={{ textAlign: "center", padding: "5rem 0", color: th.textMuted }}><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ display: "inline-block" }}><Icon name="loader" size={32} /></motion.div><div style={{ marginTop: 16, fontSize: 16 }}>Extracting article text…</div></div>
              ) : (
                <>
                  <h1 style={{ fontFamily: "'Anton', sans-serif", fontSize: 36, color: th.text, marginBottom: 24, lineHeight: 1.2 }}>{readerModal.title}</h1>
                  <a href={readerModal.url} target="_blank" rel="noreferrer" style={{ display: "inline-block", color: "#D4924A", textDecoration: "none", fontWeight: 600, fontSize: 14, marginBottom: 32 }}>View Original Article →</a>
                  <div className="reader-content" style={{ fontSize: 18, lineHeight: 1.6, color: th.text, fontFamily: "Georgia, serif" }} dangerouslySetInnerHTML={{ __html: readerModal.html }} />
                  <style>{`.reader-content p { margin-bottom: 1.5em; } .reader-content img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; } .reader-content h2 { font-family: 'DM Sans', sans-serif; font-size: 24px; margin: 2em 0 1em; color: ${th.text}; } .reader-content h3 { font-family: 'DM Sans', sans-serif; font-size: 20px; margin: 1.5em 0 1em; color: ${th.text}; } .reader-content a { color: #D4924A; text-decoration: none; } .reader-content a:hover { text-decoration: underline; } .reader-content blockquote { border-left: 4px solid ${th.border}; padding-left: 1em; margin-left: 0; font-style: italic; color: ${th.textMuted}; }`}</style>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 400, display: "flex", flexDirection: "column", gap: 8, width: "90%", maxWidth: 300 }}>
        <AnimatePresence>
          {toasts.map(t => <motion.div key={t.id} initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} style={{ background: t.type === "error" ? th.danger : th.success, color: "white", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}><Icon name={t.type === "error" ? "x" : "check"} size={14} />{t.message}</motion.div>)}
        </AnimatePresence>
      </div>

    </div>
  );
}

function LinkCard({ link, th, isSelecting, isSelected, onSelect, onDelete, onEdit, onWatch, onRead, onCopy, onTogglePin, onRestore, onPermDelete, onToggleRead, onArchive, onUnarchive, isTrash, isArchive }) {
  const plat = PLATFORMS[link.platform];
  const isYouTube = link.platform === "youtube";
  const ytId = isYouTube ? extractYouTubeId(link.url) : null;
  const showReadBtn = !["youtube", "image", "instagram", "x", "document"].includes(link.platform);
  
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2 }}
      onClick={isSelecting ? onSelect : undefined}
      style={{ background: th.cardBg, borderRadius: 14, overflow: "hidden", border: isSelected ? `2px solid ${th.selectRing}` : `1px solid ${th.borderLight}`, display: "flex", flexDirection: "column", cursor: isSelecting ? "pointer" : "default", position: "relative", boxShadow: isSelected ? `0 0 0 2px ${th.bg}, 0 0 0 4px ${th.selectRing}` : "none", transition: "box-shadow 0.2s, border 0.2s" }}
      whileHover={!isSelecting ? { y: -4, boxShadow: "0 12px 24px rgba(0,0,0,0.12)" } : {}}>
      
      {isSelecting && <div style={{ position: "absolute", top: 10, right: 10, zIndex: 10, background: isSelected ? th.selectRing : "rgba(0,0,0,0.5)", color: "white", borderRadius: "50%", padding: 4 }}>{isSelected ? <Icon name="check" size={14} /> : <div style={{ width: 14, height: 14 }} />}</div>}
      {!isSelecting && !isTrash && (
        <button onClick={(e) => { e.stopPropagation(); onTogglePin(); }} style={{ position: "absolute", top: 10, right: 10, zIndex: 10, background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", padding: 6, cursor: "pointer", color: "white", backdropFilter: "blur(4px)" }}>
          <Icon name={link.isPinned ? "starFilled" : "star"} size={14} />
        </button>
      )}

      {link.thumbnail ? <img src={link.thumbnail} alt="" style={{ width: "100%", height: 140, objectFit: "cover" }} /> : <div style={{ height: 80, background: plat?.bg || th.borderLight, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontFamily: "'Anton', sans-serif", fontSize: 18, color: plat?.color || th.textMuted, textTransform: "uppercase", opacity: 0.5 }}>{plat?.label || "Link"}</span></div>}

      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {plat && <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: plat.bg, color: plat.color }}>{plat.label}</span>}
          {link.tags?.map(t => <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: th.bg, color: th.textMuted2 }}>{t}</span>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: th.text, lineHeight: 1.4, flex: 1 }}>{link.title.length > 80 ? link.title.slice(0, 80) + "…" : link.title}</div>
          {link.isRead && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#27ae6022", color: "#27ae60", whiteSpace: "nowrap" }}>READ</span>}
        </div>
        <div style={{ fontSize: 11, color: th.textMuted }}>{link.author}</div>
        {link.note && <div style={{ fontSize: 11, color: th.textMuted, fontStyle: "italic", background: th.bg, borderRadius: 6, padding: "4px 8px", marginTop: 2 }}>📝 {link.note.length > 60 ? link.note.slice(0, 60) + "…" : link.note}</div>}
        
        {!isSelecting && (
          <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${th.borderLight}` }}>
            {isTrash ? (
              <>
                <button onClick={(e) => { e.stopPropagation(); onRestore(); }} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer", background: th.btnBg, color: th.btnText, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="restore" size={14} /> Restore</button>
                <button onClick={(e) => { e.stopPropagation(); onPermDelete(); }} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer", background: "#ffebee", color: th.danger, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon name="trash" size={14} /> Erase</button>
              </>
            ) : (
              <>
                {isYouTube && ytId ? (
                  <button onClick={(e) => { e.stopPropagation(); onWatch(ytId); }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", cursor: "pointer", background: th.btnBg, color: th.btnText, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Icon name="play" size={14} /> Watch</button>
                ) : showReadBtn ? (
                  <button onClick={(e) => { e.stopPropagation(); onRead(link.url); }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", cursor: "pointer", background: th.btnBg, color: th.btnText, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Icon name="book" size={14} /> Read</button>
                ) : (
                  <a href={link.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ padding: "8px 16px", borderRadius: 10, background: th.btnBg, color: th.btnText, fontSize: 13, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}><Icon name="external" size={14} /> Open</a>
                )}
                
                <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
                  <button onClick={(e) => { e.stopPropagation(); onToggleRead(); }} title={link.isRead ? "Mark Unread" : "Mark Read"} style={{ padding: "8px", borderRadius: 8, border: "none", background: link.isRead ? "#27ae6022" : "transparent", cursor: "pointer", color: link.isRead ? "#27ae60" : th.textMuted2 }}><Icon name="check" size={15} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onCopy(); }} style={{ padding: "8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: th.textMuted2 }}><Icon name="copy" size={15} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onEdit(link); }} style={{ padding: "8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: th.textMuted2 }}><Icon name="edit" size={15} /></button>
                  {isArchive ? <button onClick={(e) => { e.stopPropagation(); onUnarchive(); }} style={{ padding: "8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: th.textMuted2 }}><Icon name="restore" size={15} /></button> : <button onClick={(e) => { e.stopPropagation(); onArchive(); }} title="Archive" style={{ padding: "8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: th.textMuted2 }}><Icon name="archive" size={15} /></button>}
                  <button onClick={(e) => { e.stopPropagation(); onDelete(link.id); }} style={{ padding: "8px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: th.danger }}><Icon name="trash" size={15} /></button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
