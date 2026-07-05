(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const API_URL = new URL("api.php", document.currentScript?.src || document.baseURI);
  const elements = {
    recorderView: $("#recorderView"),
    editorView: $("#editorView"),
    recordButton: $("#recordButton"),
    recordLabel: $("#recordLabel"),
    recordTimer: $("#recordTimer"),
    permissionNote: $("#permissionNote"),
    newButton: $("#newButton"),
    waveform: $("#waveform"),
    waveformWrap: $("#waveformWrap"),
    leftShade: $("#leftShade"),
    rightShade: $("#rightShade"),
    playhead: $("#playhead"),
    trimStart: $("#trimStart"),
    trimEnd: $("#trimEnd"),
    startTimeInput: $("#startTimeInput"),
    endTimeInput: $("#endTimeInput"),
    currentTime: $("#currentTime"),
    selectionDuration: $("#selectionDuration"),
    playButton: $("#playButton"),
    fadeIn: $("#fadeIn"),
    fadeOut: $("#fadeOut"),
    normalize: $("#normalize"),
    exportButton: $("#exportButton"),
    exportLabel: $("#exportLabel"),
    exportStatus: $("#exportStatus"),
    sendSessionButton: $("#sendSessionButton"),
    sendSessionCode: $("#sendSessionCode"),
    sessionButton: $("#sessionButton"),
    sessionButtonLabel: $("#sessionButtonLabel"),
    sessionLayer: $("#sessionLayer"),
    sessionBackdrop: $("#sessionBackdrop"),
    closeSessionButton: $("#closeSessionButton"),
    sessionSetup: $("#sessionSetup"),
    sessionConnected: $("#sessionConnected"),
    createSessionButton: $("#createSessionButton"),
    joinSessionForm: $("#joinSessionForm"),
    sessionCodeInput: $("#sessionCodeInput"),
    activeSessionCode: $("#activeSessionCode"),
    copySessionCode: $("#copySessionCode"),
    uploadCurrentButton: $("#uploadCurrentButton"),
    sessionFileInput: $("#sessionFileInput"),
    sessionFiles: $("#sessionFiles"),
    sessionSyncStatus: $("#sessionSyncStatus"),
    refreshSessionButton: $("#refreshSessionButton"),
    leaveSessionButton: $("#leaveSessionButton"),
    toast: $("#toast")
  };

  let audioContext;
  let audioBuffer;
  let mediaRecorder;
  let mediaStream;
  let recordedChunks = [];
  let recordingStartedAt = 0;
  let recordingTimerId;
  let sourceNode;
  let gainNode;
  let playStartedAt = 0;
  let playOffset = 0;
  let playAnimationId;
  let toastTimer;
  let sharedSessionCode = "";
  let sessionPollId;
  let sessionBusy = false;

  const trim = { start: 0, end: 0 };
  const MIN_SELECTION = 0.1;
  const FADE_SECONDS = 0.35;

  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
      audioContext = new AudioContextClass();
    }
    return audioContext;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const tenths = Math.floor((safe % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3800);
  }

  function preferredMimeType() {
    const options = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/webm"
    ];
    return options.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
  }

  function recorderSupportIssue() {
    if (!window.isSecureContext) {
      return {
        note: "Microphone blocked — open this page over HTTPS.",
        message: "Microphone access needs HTTPS on mobile. An http:// LAN address is not secure, even if it points to your computer."
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        note: "Microphone access is unavailable in this browser.",
        message: "This browser is not exposing microphone access. Check its site permissions and make sure the page is opened directly, not inside another app."
      };
    }
    if (!window.MediaRecorder) {
      return {
        note: "Audio recording is unavailable in this browser version.",
        message: "This browser version does not include audio recording support. Update the browser or operating system and try again."
      };
    }
    return null;
  }

  function updateEnvironmentNotice() {
    const issue = recorderSupportIssue();
    elements.permissionNote.classList.toggle("is-warning", Boolean(issue));
    elements.permissionNote.textContent = issue
      ? issue.note
      : "Your browser will ask for microphone access.";
  }

  function microphoneErrorMessage(error) {
    if (!window.isSecureContext || error?.name === "SecurityError") {
      return "Microphone access needs HTTPS. Open the secure https:// version of this page.";
    }
    if (window.top !== window.self && error?.name === "NotAllowedError") {
      return "Microphone access was blocked inside this embedded page. Open the app directly in Safari or Edge.";
    }
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      return "Microphone permission is blocked. Allow it for this site in the browser or phone settings, then reload.";
    }
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      return "No microphone was found on this device.";
    }
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
      return "The microphone is busy or unavailable. Close other recording apps and try again.";
    }
    return `The microphone could not be started${error?.name ? ` (${error.name})` : ""}.`;
  }

  async function startRecording() {
    const supportIssue = recorderSupportIssue();
    if (supportIssue) {
      showToast(supportIssue.message);
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const mimeType = preferredMimeType();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      recordedChunks = [];
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) recordedChunks.push(event.data);
      });
      mediaRecorder.addEventListener("stop", finishRecording, { once: true });
      mediaRecorder.start(250);
      recordingStartedAt = performance.now();
      elements.recordButton.classList.add("is-recording");
      elements.recordButton.setAttribute("aria-label", "Stop recording");
      elements.recordLabel.textContent = "Tap to stop";
      elements.permissionNote.textContent = "Recording…";
      updateRecordingTimer();
      recordingTimerId = setInterval(updateRecordingTimer, 100);
    } catch (error) {
      console.error("Microphone start failed:", error);
      showToast(microphoneErrorMessage(error));
      resetRecorderControls();
    }
  }

  function stopRecording() {
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  }

  function updateRecordingTimer() {
    const elapsed = (performance.now() - recordingStartedAt) / 1000;
    elements.recordTimer.textContent = formatTime(elapsed);
  }

  function resetRecorderControls() {
    clearInterval(recordingTimerId);
    elements.recordButton.classList.remove("is-recording");
    elements.recordButton.setAttribute("aria-label", "Start recording");
    elements.recordLabel.textContent = "Tap to record";
    updateEnvironmentNotice();
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    mediaRecorder = null;
  }

  async function finishRecording() {
    const recordedType = mediaRecorder?.mimeType || recordedChunks[0]?.type || "audio/webm";
    const blob = new Blob(recordedChunks, { type: recordedType });
    resetRecorderControls();

    if (!blob.size) {
      showToast("No sound was captured. Give it another try.");
      return;
    }

    try {
      elements.recordLabel.textContent = "Preparing audio…";
      const context = getAudioContext();
      const data = await blob.arrayBuffer();
      audioBuffer = await context.decodeAudioData(data.slice(0));
      if (audioBuffer.duration < MIN_SELECTION) throw new Error("Recording is too short.");
      openEditor();
    } catch (error) {
      console.error(error);
      showToast("That recording could not be opened. Try recording again.");
      resetRecorderControls();
    }
  }

  function openEditor() {
    trim.start = 0;
    trim.end = audioBuffer.duration;
    elements.trimStart.value = "0";
    elements.trimEnd.value = "1000";
    elements.fadeIn.checked = false;
    elements.fadeOut.checked = false;
    elements.normalize.checked = true;
    elements.recorderView.hidden = true;
    elements.editorView.hidden = false;
    updateSessionControls();
    updateTrimUI();
    requestAnimationFrame(drawWaveform);
  }

  function closeEditor() {
    stopPlayback();
    audioBuffer = null;
    updateSessionControls();
    elements.editorView.hidden = true;
    elements.recorderView.hidden = false;
    elements.recordTimer.textContent = "00:00.0";
    elements.recordLabel.textContent = "Tap to record";
  }

  function updateTrimFromSliders(changed) {
    if (!audioBuffer) return;
    let startRatio = Number(elements.trimStart.value) / 1000;
    let endRatio = Number(elements.trimEnd.value) / 1000;
    const minRatio = MIN_SELECTION / audioBuffer.duration;

    if (endRatio - startRatio < minRatio) {
      if (changed === "start") startRatio = Math.max(0, endRatio - minRatio);
      else endRatio = Math.min(1, startRatio + minRatio);
    }

    elements.trimStart.value = String(Math.round(startRatio * 1000));
    elements.trimEnd.value = String(Math.round(endRatio * 1000));
    trim.start = startRatio * audioBuffer.duration;
    trim.end = endRatio * audioBuffer.duration;
    stopPlayback();
    updateTrimUI();
  }

  function updateTrimFromInput(changed) {
    if (!audioBuffer) return;
    const entered = Number(changed === "start" ? elements.startTimeInput.value : elements.endTimeInput.value);
    if (!Number.isFinite(entered)) {
      updateTrimUI();
      return;
    }

    if (changed === "start") trim.start = Math.max(0, Math.min(entered, trim.end - MIN_SELECTION));
    else trim.end = Math.min(audioBuffer.duration, Math.max(entered, trim.start + MIN_SELECTION));

    elements.trimStart.value = String(Math.round((trim.start / audioBuffer.duration) * 1000));
    elements.trimEnd.value = String(Math.round((trim.end / audioBuffer.duration) * 1000));
    stopPlayback();
    updateTrimUI();
  }

  function updateTrimUI() {
    if (!audioBuffer) return;
    const startPercent = (trim.start / audioBuffer.duration) * 100;
    const endPercent = (trim.end / audioBuffer.duration) * 100;
    elements.leftShade.style.width = `${startPercent}%`;
    elements.rightShade.style.width = `${100 - endPercent}%`;
    elements.startTimeInput.value = trim.start.toFixed(1);
    elements.endTimeInput.value = trim.end.toFixed(1);
    elements.currentTime.textContent = `${formatTime(trim.start)} — ${formatTime(trim.end)}`;
    elements.selectionDuration.textContent = `${formatTime(trim.end - trim.start)} selected`;
  }

  function drawWaveform() {
    if (!audioBuffer) return;
    const canvas = elements.waveform;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    const middle = height / 2;
    const data = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / width));

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#171713";
    ctx.lineWidth = 1.25;
    ctx.beginPath();

    for (let x = 0; x < width; x += 1) {
      const start = x * samplesPerPixel;
      let min = 1;
      let max = -1;
      const end = Math.min(start + samplesPerPixel, data.length);
      for (let i = start; i < end; i += Math.max(1, Math.floor(samplesPerPixel / 32))) {
        const value = data[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const y1 = middle + min * middle * 0.84;
      const y2 = middle + max * middle * 0.84;
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
  }

  async function togglePlayback() {
    if (sourceNode) {
      stopPlayback();
      return;
    }
    if (!audioBuffer) return;

    const context = getAudioContext();
    await context.resume();
    sourceNode = context.createBufferSource();
    gainNode = context.createGain();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(gainNode).connect(context.destination);

    const duration = trim.end - trim.start;
    const fade = Math.min(FADE_SECONDS, duration / 2);
    const now = context.currentTime;
    gainNode.gain.setValueAtTime(elements.fadeIn.checked ? 0 : 1, now);
    if (elements.fadeIn.checked) gainNode.gain.linearRampToValueAtTime(1, now + fade);
    if (elements.fadeOut.checked) {
      gainNode.gain.setValueAtTime(1, now + Math.max(0, duration - fade));
      gainNode.gain.linearRampToValueAtTime(0, now + duration);
    }

    playStartedAt = context.currentTime;
    playOffset = trim.start;
    sourceNode.start(0, trim.start, duration);
    sourceNode.addEventListener("ended", stopPlayback, { once: true });
    elements.playButton.classList.add("is-playing");
    elements.playButton.querySelector("span").textContent = "Stop preview";
    elements.playhead.style.opacity = "1";
    animatePlayhead();
  }

  function animatePlayhead() {
    if (!sourceNode || !audioBuffer) return;
    const elapsed = getAudioContext().currentTime - playStartedAt;
    const current = Math.min(trim.end, playOffset + elapsed);
    elements.playhead.style.left = `${(current / audioBuffer.duration) * 100}%`;
    playAnimationId = requestAnimationFrame(animatePlayhead);
  }

  function stopPlayback() {
    if (sourceNode) {
      const oldSource = sourceNode;
      sourceNode = null;
      try { oldSource.stop(); } catch (_) {}
      oldSource.disconnect();
    }
    gainNode?.disconnect();
    gainNode = null;
    cancelAnimationFrame(playAnimationId);
    elements.playButton.classList.remove("is-playing");
    elements.playButton.querySelector("span").textContent = "Preview cut";
    elements.playhead.style.opacity = "0";
  }

  function editedPcmChannels() {
    const sampleRate = audioBuffer.sampleRate;
    const startFrame = Math.floor(trim.start * sampleRate);
    const endFrame = Math.ceil(trim.end * sampleRate);
    const frameCount = endFrame - startFrame;
    const channelCount = Math.min(2, audioBuffer.numberOfChannels);
    const channels = [];
    let peak = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = audioBuffer.getChannelData(channel);
      const output = new Float32Array(frameCount);
      output.set(source.subarray(startFrame, endFrame));
      for (let i = 0; i < output.length; i += 1) peak = Math.max(peak, Math.abs(output[i]));
      channels.push(output);
    }

    const level = elements.normalize.checked && peak > 0 ? Math.min(1 / peak, 4) * 0.96 : 1;
    const fadeFrames = Math.min(Math.round(FADE_SECONDS * sampleRate), Math.floor(frameCount / 2));

    return channels.map((channel) => {
      const pcm = new Int16Array(frameCount);
      for (let i = 0; i < frameCount; i += 1) {
        let multiplier = level;
        if (elements.fadeIn.checked && i < fadeFrames) multiplier *= i / fadeFrames;
        if (elements.fadeOut.checked && i >= frameCount - fadeFrames) multiplier *= (frameCount - 1 - i) / fadeFrames;
        const sample = Math.max(-1, Math.min(1, channel[i] * multiplier));
        pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      return pcm;
    });
  }

  async function createMp3Blob() {
    if (!window.lamejs?.Mp3Encoder) {
      throw new Error("The MP3 encoder did not load. Check your connection and try again.");
    }

    stopPlayback();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const channels = editedPcmChannels();
    const encoder = new window.lamejs.Mp3Encoder(channels.length, audioBuffer.sampleRate, 128);
    const chunks = [];
    const blockSize = 1152;

    for (let i = 0; i < channels[0].length; i += blockSize) {
      const left = channels[0].subarray(i, i + blockSize);
      const encoded = channels.length === 2
        ? encoder.encodeBuffer(left, channels[1].subarray(i, i + blockSize))
        : encoder.encodeBuffer(left);
      if (encoded.length) chunks.push(new Uint8Array(encoded));
    }

    const flushed = encoder.flush();
    if (flushed.length) chunks.push(new Uint8Array(flushed));
    return new Blob(chunks, { type: "audio/mpeg" });
  }

  async function exportMp3() {
    if (!audioBuffer || elements.exportButton.disabled) return;
    elements.exportButton.disabled = true;
    elements.exportLabel.textContent = "Encoding…";
    elements.exportStatus.textContent = "Keeping everything on this device";

    try {
      const mp3 = await createMp3Blob();
      const url = URL.createObjectURL(mp3);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      link.href = url;
      link.download = `bubble-m-${stamp}.mp3`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Your MP3 is ready.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "MP3 export failed. Try a shorter recording or another browser.");
    } finally {
      elements.exportButton.disabled = false;
      elements.exportLabel.textContent = "Save as MP3";
      elements.exportStatus.textContent = "128 kbps · edited selection";
    }
  }

  function deviceName() {
    const mobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return mobile ? "Mobile device" : "Computer";
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function apiRequest(action, options = {}) {
    const { params = {}, ...fetchOptions } = options;
    const query = new URLSearchParams({ action, ...params });
    const requestUrl = new URL(API_URL);
    requestUrl.search = query.toString();
    let response;
    try {
      response = await fetch(requestUrl, {
        cache: "no-store",
        ...fetchOptions
      });
    } catch (cause) {
      const error = new Error(`Cannot reach the session API at ${requestUrl.pathname}.`);
      error.cause = cause;
      throw error;
    }
    const responseText = await response.text();
    const jsonStart = responseText.indexOf("{");
    const jsonEnd = responseText.lastIndexOf("}");
    let data = null;
    if (jsonStart !== -1 && jsonEnd >= jsonStart) {
      try {
        data = JSON.parse(responseText.slice(jsonStart, jsonEnd + 1));
      } catch (_) {}
    }
    if (!response.ok || !data?.ok) {
      let message = data?.error;
      if (!message && data?.storageWritable === false) {
        message = "Session storage is not writable on the server.";
      } else if (!message && response.status === 404) {
        message = `Session API not found at ${requestUrl.pathname}. Upload api.php beside app.js.`;
      } else if (!message && response.status >= 500) {
        message = `Session server error (HTTP ${response.status}). Check the server PHP error log and storage permissions.`;
      } else if (!message && responseText.includes("<?php")) {
        message = "This host is serving PHP as text instead of executing it. Shared sessions require PHP hosting.";
      } else if (!message) {
        message = `Invalid response from the session server (HTTP ${response.status}).`;
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function openSessionPanel() {
    elements.sessionLayer.hidden = false;
    document.body.classList.add("has-modal");
    if (sharedSessionCode) syncSession();
    else setTimeout(() => elements.sessionCodeInput.focus(), 50);
  }

  function closeSessionPanel() {
    elements.sessionLayer.hidden = true;
    document.body.classList.remove("has-modal");
  }

  function updateSessionControls() {
    const connected = Boolean(sharedSessionCode);
    elements.sessionButton.classList.toggle("is-connected", connected);
    elements.sessionButtonLabel.textContent = connected ? sharedSessionCode : "Share session";
    elements.sessionSetup.hidden = connected;
    elements.sessionConnected.hidden = !connected;
    elements.sendSessionButton.hidden = !(connected && audioBuffer);
    elements.uploadCurrentButton.hidden = !audioBuffer;
    if (connected) {
      elements.activeSessionCode.textContent = sharedSessionCode;
      elements.sendSessionCode.textContent = sharedSessionCode;
    }
  }

  function setSharedSession(session) {
    sharedSessionCode = session.code;
    localStorage.setItem("bubbleMSession", sharedSessionCode);
    clearInterval(sessionPollId);
    sessionPollId = setInterval(() => syncSession(true), 4000);
    updateSessionControls();
    renderSessionFiles(session.files || []);
  }

  function leaveSharedSession(showMessage = true) {
    sharedSessionCode = "";
    localStorage.removeItem("bubbleMSession");
    clearInterval(sessionPollId);
    sessionPollId = null;
    elements.sessionFiles.replaceChildren();
    elements.sessionCodeInput.value = "";
    updateSessionControls();
    if (showMessage) showToast("You left the shared session. Server files remain until it expires.");
  }

  async function createSession() {
    if (sessionBusy) return;
    sessionBusy = true;
    elements.createSessionButton.disabled = true;
    elements.createSessionButton.firstChild.textContent = "Creating session ";
    try {
      const data = await apiRequest("create", { method: "POST" });
      setSharedSession(data.session);
      showToast(`Session ${data.session.code} is ready. Open it on your other device.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      sessionBusy = false;
      elements.createSessionButton.disabled = false;
      elements.createSessionButton.firstChild.textContent = "Create a new session ";
    }
  }

  async function joinSession(event) {
    event.preventDefault();
    if (sessionBusy) return;
    const code = elements.sessionCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) {
      showToast("Enter the full six-character code.");
      return;
    }

    sessionBusy = true;
    const button = elements.joinSessionForm.querySelector("button");
    button.disabled = true;
    button.textContent = "Joining…";
    try {
      const data = await apiRequest("join", { params: { code } });
      setSharedSession(data.session);
      showToast(`Connected to session ${code}.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      sessionBusy = false;
      button.disabled = false;
      button.textContent = "Join";
    }
  }

  async function syncSession(silent = false) {
    if (!sharedSessionCode || sessionBusy) return;
    if (!silent) elements.sessionSyncStatus.textContent = "Syncing…";
    try {
      const data = await apiRequest("list", { params: { code: sharedSessionCode } });
      renderSessionFiles(data.session.files || []);
      elements.sessionSyncStatus.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } catch (error) {
      if (error.status === 404) {
        leaveSharedSession(false);
        showToast("This shared session expired or no longer exists.");
      } else if (!silent) {
        elements.sessionSyncStatus.textContent = "Could not sync";
        showToast(error.message);
      }
    }
  }

  function createSessionFileCard(file) {
    const card = document.createElement("article");
    card.className = "session-file";
    card.dataset.fileId = file.id;

    const info = document.createElement("div");
    info.className = "session-file-info";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const meta = document.createElement("small");
    const when = new Date(file.createdAt * 1000).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    meta.textContent = `${file.device} · ${formatBytes(file.size)} · ${when}`;
    info.append(name, meta);

    const download = document.createElement("a");
    download.href = file.url;
    download.download = file.name;
    download.textContent = "Download";

    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "none";
    player.src = file.url;
    card.append(info, download, player);
    return card;
  }

  function renderSessionFiles(files) {
    const incomingIds = new Set(files.map((file) => file.id));
    const existingCards = new Map();

    elements.sessionFiles.querySelectorAll(".session-file").forEach((card) => {
      if (!incomingIds.has(card.dataset.fileId)) {
        card.querySelector("audio")?.pause();
        card.remove();
      } else {
        existingCards.set(card.dataset.fileId, card);
      }
    });

    if (!files.length) {
      if (!elements.sessionFiles.querySelector(".session-empty")) {
        const empty = document.createElement("p");
        empty.className = "session-empty";
        empty.textContent = "No audio yet. Send a recording or upload a file from either device.";
        elements.sessionFiles.appendChild(empty);
      }
      return;
    }

    elements.sessionFiles.querySelector(".session-empty")?.remove();
    const newCards = document.createDocumentFragment();
    [...files].reverse().forEach((file) => {
      if (!existingCards.has(file.id)) {
        newCards.appendChild(createSessionFileCard(file));
      }
    });
    if (newCards.childNodes.length) {
      elements.sessionFiles.prepend(newCards);
    }
  }

  async function uploadToSession(blob, filename) {
    if (!sharedSessionCode || sessionBusy) return;
    if (blob.size > 25 * 1024 * 1024) {
      showToast("Audio files must be smaller than 25 MB.");
      return;
    }

    sessionBusy = true;
    elements.sessionSyncStatus.textContent = "Uploading…";
    elements.uploadCurrentButton.disabled = true;
    elements.sendSessionButton.disabled = true;
    const body = new FormData();
    body.append("code", sharedSessionCode);
    body.append("device", deviceName());
    body.append("audio", blob, filename);

    try {
      await apiRequest("upload", { method: "POST", body });
      showToast(`Audio sent to session ${sharedSessionCode}.`);
      sessionBusy = false;
      await syncSession();
    } catch (error) {
      showToast(error.message);
      elements.sessionSyncStatus.textContent = "Upload failed";
    } finally {
      sessionBusy = false;
      elements.uploadCurrentButton.disabled = false;
      elements.sendSessionButton.disabled = false;
    }
  }

  async function sendCurrentEdit() {
    if (!audioBuffer || !sharedSessionCode || sessionBusy) return;
    const oldText = elements.uploadCurrentButton.textContent;
    elements.uploadCurrentButton.textContent = "Encoding…";
    elements.sendSessionButton.textContent = "Encoding…";
    try {
      const mp3 = await createMp3Blob();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      await uploadToSession(mp3, `bubble-m-${stamp}.mp3`);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not prepare this recording.");
    } finally {
      elements.uploadCurrentButton.textContent = oldText;
      elements.sendSessionButton.replaceChildren("Send to ", elements.sendSessionCode);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(sharedSessionCode);
      showToast("Session code copied.");
    } catch (_) {
      const field = document.createElement("textarea");
      field.value = sharedSessionCode;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
      showToast("Session code copied.");
    }
  }

  async function restoreSession() {
    const saved = (localStorage.getItem("bubbleMSession") || "").toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(saved)) return;
    sharedSessionCode = saved;
    updateSessionControls();
    try {
      const data = await apiRequest("list", { params: { code: saved } });
      setSharedSession(data.session);
    } catch (_) {
      leaveSharedSession(false);
    }
  }

  elements.recordButton.addEventListener("click", () => {
    if (mediaRecorder?.state === "recording") stopRecording();
    else startRecording();
  });
  elements.newButton.addEventListener("click", closeEditor);
  elements.trimStart.addEventListener("input", () => updateTrimFromSliders("start"));
  elements.trimEnd.addEventListener("input", () => updateTrimFromSliders("end"));
  elements.startTimeInput.addEventListener("change", () => updateTrimFromInput("start"));
  elements.endTimeInput.addEventListener("change", () => updateTrimFromInput("end"));
  elements.playButton.addEventListener("click", togglePlayback);
  elements.exportButton.addEventListener("click", exportMp3);
  elements.sendSessionButton.addEventListener("click", sendCurrentEdit);
  elements.fadeIn.addEventListener("change", stopPlayback);
  elements.fadeOut.addEventListener("change", stopPlayback);
  elements.waveformWrap.addEventListener("click", (event) => {
    if (!audioBuffer) return;
    const rect = elements.waveformWrap.getBoundingClientRect();
    const clickedTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * audioBuffer.duration;
    const boundary = Math.abs(clickedTime - trim.start) < Math.abs(clickedTime - trim.end) ? "start" : "end";
    if (boundary === "start") trim.start = Math.min(clickedTime, trim.end - MIN_SELECTION);
    else trim.end = Math.max(clickedTime, trim.start + MIN_SELECTION);
    elements.trimStart.value = String(Math.round((trim.start / audioBuffer.duration) * 1000));
    elements.trimEnd.value = String(Math.round((trim.end / audioBuffer.duration) * 1000));
    stopPlayback();
    updateTrimUI();
  });
  elements.sessionButton.addEventListener("click", openSessionPanel);
  elements.sessionBackdrop.addEventListener("click", closeSessionPanel);
  elements.closeSessionButton.addEventListener("click", closeSessionPanel);
  elements.createSessionButton.addEventListener("click", createSession);
  elements.joinSessionForm.addEventListener("submit", joinSession);
  elements.sessionCodeInput.addEventListener("input", () => {
    elements.sessionCodeInput.value = elements.sessionCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  elements.copySessionCode.addEventListener("click", copyCode);
  elements.uploadCurrentButton.addEventListener("click", sendCurrentEdit);
  elements.refreshSessionButton.addEventListener("click", () => syncSession());
  elements.leaveSessionButton.addEventListener("click", () => leaveSharedSession());
  elements.sessionFileInput.addEventListener("change", () => {
    const file = elements.sessionFileInput.files?.[0];
    if (file) uploadToSession(file, file.name);
    elements.sessionFileInput.value = "";
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.sessionLayer.hidden) closeSessionPanel();
  });

  const resizeObserver = new ResizeObserver(() => requestAnimationFrame(drawWaveform));
  resizeObserver.observe(elements.waveformWrap);
  updateEnvironmentNotice();
  updateSessionControls();
  restoreSession();
})();
