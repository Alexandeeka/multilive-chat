import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const tiktokConnections = new Map();
const youtubeJobs = new Map();

function emitStatus(platform, status, detail = "") {
  io.emit("platform-status", { platform, status, detail });
}
function emitChat(platform, username, message, extra = {}) {
  io.emit("chat-message", {
    platform, username: username || "Unknown", message: String(message || ""),
    time: new Date().toISOString(), ...extra
  });
}
function emitViewerCount(socket, platform, count) {
  const n = Number(count);
  socket.emit("viewer-count", {
    platform,
    count: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  });
}
function cleanHandle(value = "") {
  return value.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "").replace(/\/.*$/, "");
}
function cleanYoutubeHandle(value = "") {
  return value.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//i, "").replace(/^@/, "");
}

async function yt(path, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY belum diatur di file .env");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...params, key }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `YouTube API error ${res.status}`);
  return data;
}

async function findYoutubeLive(handle) {
  let channelId = handle;
  if (handle.startsWith("@")) {
    const c = await yt("channels", { part: "id", forHandle: handle });
    channelId = c.items?.[0]?.id;
  } else if (!handle.startsWith("UC")) {
    const c = await yt("channels", { part: "id", forUsername: handle });
    channelId = c.items?.[0]?.id;
  }
  if (!channelId) throw new Error("Channel YouTube tidak ditemukan. Coba masukkan @handle atau Channel ID.");
  const search = await yt("search", {
    part: "id", channelId, eventType: "live", type: "video", maxResults: "1"
  });
  const videoId = search.items?.[0]?.id?.videoId;
  if (!videoId) return null;
  const video = await yt("videos", { part: "liveStreamingDetails,snippet", id: videoId });
  const item = video.items?.[0];
  const liveChatId = item?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) return null;
  return {
    liveChatId,
    videoId,
    title: item.snippet?.title || "YouTube LIVE",
    viewers: Number(item.liveStreamingDetails?.concurrentViewers || 0)
  };
}

async function startYoutube(socket, handle) {
  stopYoutube(socket.id);
  try {
    emitStatus("youtube", "checking", "Memeriksa siaran...");
    const live = await findYoutubeLive(cleanYoutubeHandle(handle));
    if (!live) {
      emitStatus("youtube", "offline", "Channel tidak sedang live.");
      return;
    }
    emitStatus("youtube", "live", live.title);
    emitViewerCount(socket, "youtube", live.viewers);
    let pageToken = "";
    let stopped = false;
    let viewerTimer = null;
    const job = { stop: () => { stopped = true; if (viewerTimer) clearInterval(viewerTimer); } };
    youtubeJobs.set(socket.id, job);
    viewerTimer = setInterval(async () => {
      if (stopped) return;
      try {
        const fresh = await yt("videos", { part: "liveStreamingDetails", id: live.videoId });
        const details = fresh.items?.[0]?.liveStreamingDetails;
        if (!details?.activeLiveChatId) {
          emitViewerCount(socket, "youtube", 0);
          emitStatus("youtube", "offline", "Siaran telah berakhir.");
          stopYoutube(socket.id);
          return;
        }
        emitViewerCount(socket, "youtube", details.concurrentViewers || 0);
      } catch {
        // Pertahankan angka terakhir jika permintaan jumlah penonton gagal.
      }
    }, 30000);

    async function poll() {
      if (stopped) return;
      try {
        const params = { liveChatId: live.liveChatId, part: "snippet,authorDetails", maxResults: "200" };
        if (pageToken) params.pageToken = pageToken;
        const data = await yt("liveChat/messages", params);
        pageToken = data.nextPageToken || pageToken;
        for (const item of (data.items || [])) {
          if (item.snippet?.type === "textMessageEvent") {
            emitChat("youtube", item.authorDetails?.displayName, item.snippet?.textMessageDetails?.messageText);
          }
        }
        if (data.offlineAt) {
          emitStatus("youtube", "offline", "Siaran telah berakhir.");
          stopYoutube(socket.id);
          return;
        }
        setTimeout(poll, Math.max(data.pollingIntervalMillis || 5000, 2000));
      } catch (err) {
        emitStatus("youtube", "error", err.message);
        stopYoutube(socket.id);
      }
    }
    poll();
  } catch (err) {
    emitStatus("youtube", "error", err.message);
  }
}
function stopYoutube(id) {
  const job = youtubeJobs.get(id);
  if (job) job.stop();
  youtubeJobs.delete(id);
}

async function startTiktok(socket, username) {
  stopTiktok(socket.id);
  const handle = cleanHandle(username);
  if (!handle) {
    emitStatus("tiktok", "error", "Masukkan username TikTok.");
    return;
  }
  emitStatus("tiktok", "checking", "Memeriksa LIVE...");
  const connection = new TikTokLiveConnection(handle);
  tiktokConnections.set(socket.id, connection);

  connection.on(WebcastEvent.CHAT, data => {
    emitChat("tiktok", data.user?.nickname || data.user?.uniqueId, data.comment);
  });
  connection.on(WebcastEvent.GIFT, data => {
    const gift = data.giftName || `Gift ${data.giftId || ""}`;
    emitChat("tiktok", data.user?.nickname || data.user?.uniqueId, `🎁 ${gift} x${data.repeatCount || 1}`);
  });
  connection.on("streamEnd", () => {
    emitViewerCount(socket, "tiktok", 0);
    emitStatus("tiktok", "offline", "Siaran telah berakhir.");
    stopTiktok(socket.id);
  });
  connection.on("error", err => {
    emitStatus("tiktok", "error", err?.message || "Koneksi TikTok bermasalah.");
  });

  connection.on(WebcastEvent.ROOM_USER, data => {
    const count = data?.viewerCount ?? data?.viewer_count ?? data?.userCount;
    if (count !== undefined) emitViewerCount(socket, "tiktok", count);
  });

  try {
    const result = await connection.connect();
    const room = result?.roomInfo || result?.room_info || {};
    const stats = room?.stats || {};
    const initialCount = stats?.userCount ?? stats?.user_count ??
      room?.userCount ?? room?.user_count ?? 0;
    emitViewerCount(socket, "tiktok", initialCount);
    emitStatus("tiktok", "live", `Terhubung ke @${handle}`);
  } catch (err) {
    tiktokConnections.delete(socket.id);
    const offline = /offline|not live|room.*not found/i.test(err?.message || "");
    emitViewerCount(socket, "tiktok", 0);
    emitStatus("tiktok", offline ? "offline" : "error",
      offline ? "Akun tidak sedang LIVE." : (err?.message || "Gagal menghubungkan TikTok."));
  }
}
function stopTiktok(id) {
  const connection = tiktokConnections.get(id);
  if (connection) {
    try { connection.disconnect(); } catch {}
  }
  tiktokConnections.delete(id);
}

io.on("connection", socket => {
  socket.on("connect-platforms", async ({ tiktok, youtube }) => {
    if (tiktok?.trim()) startTiktok(socket, tiktok);
    else emitStatus("tiktok", "idle", "Belum dihubungkan.");
    if (youtube?.trim()) startYoutube(socket, youtube);
    else emitStatus("youtube", "idle", "Belum dihubungkan.");
  });
  socket.on("disconnect-platforms", () => {
    stopTiktok(socket.id);
    stopYoutube(socket.id);
    emitViewerCount(socket, "tiktok", 0);
    emitViewerCount(socket, "youtube", 0);
    emitStatus("tiktok", "idle", "Terputus.");
    emitStatus("youtube", "idle", "Terputus.");
  });
  socket.on("disconnect", () => {
    stopTiktok(socket.id);
    stopYoutube(socket.id);
  });
});

server.listen(PORT, () => console.log(`Multi Live Chat berjalan di http://localhost:${PORT}`));
