// =====================================================
// 🧠 VOIP CLIENT (ROOM-BASED GROUP CALL VERSION - FIXED)
// =====================================================

// 🌍 GLOBAL STATE
let socket;
let username;
let roomName = "default";

let localStream;
let mediaStarting = false;
let callLock = false;

// WebRTC
let peerConnections = {};
let remoteStreams = {};
let iceCandidateBuffer = {};

// call state
let pendingCall = null;

// UI
const loginSection = document.getElementById("login-section");
const appSection = document.getElementById("app-section");

const userList = document.getElementById("user-list");
const statusDiv = document.getElementById("status");

const localVideo = document.getElementById("local-video");

const incomingCallDiv = document.getElementById("incoming-call");
const callerName = document.getElementById("caller-name");

const callControls = document.getElementById("call-controls");


// =====================================================
// 🔌 JOIN SERVER
// =====================================================
function joinServer() {

    username = document.getElementById("username-input").value.trim();
    if (!username) return alert("Enter username");

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const port = location.protocol === "https:" ? "" : ":3000";

    socket = new WebSocket(`${protocol}//${location.hostname}${port}`);

    socket.onopen = () => {

        socket.send(JSON.stringify({
            type: "register",
            name: username,
            room: roomName
        }));

        loginSection.style.display = "none";
        appSection.style.display = "block";

        statusDiv.innerText = `Joined room: ${roomName}`;

        startHeartbeat();
    };

    socket.onmessage = async (msg) => {

        const data = JSON.parse(msg.data);

        switch (data.type) {

            case "user-list":
                updateUserList(data.users);
                break;

            case "user-joined":
                addUser(data.name);
                break;

            case "user-left":
                removeUser(data.name);
                break;

            case "error":
                alert(data.message);
                return;

            case "offer":

                if (!data.from || !data.offer) return;

                pendingCall = {
                    from: data.from,
                    offer: data.offer
                };

                callerName.innerText = `${data.from} is calling you`;
                incomingCallDiv.style.display = "block";

                statusDiv.innerText = "Incoming call...";
                break;

            case "answer": {
                const pc = peerConnections[data.from];

                if (pc) {
                    await pc.setRemoteDescription(data.answer);
                    await flushIceCandidates(data.from);
                }

                statusDiv.innerText = `Connected with ${data.from}`;
                break;
            }

            case "ice-candidate": {
                const pc = peerConnections[data.from];

                if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(data.candidate);
                } else {
                    if (!iceCandidateBuffer[data.from]) {
                        iceCandidateBuffer[data.from] = [];
                    }
                    iceCandidateBuffer[data.from].push(data.candidate);
                }
                break;
            }

            case "pong":
                break;
        }
    };
}


// =====================================================
// 💓 HEARTBEAT
// =====================================================
function startHeartbeat() {
    return setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
        }
    }, 5000);
}


// =====================================================
// 🎥 MEDIA (FIXED)
// =====================================================
async function startMedia() {

    if (localStream) return localStream;
    if (mediaStarting) return;

    mediaStarting = true;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        localVideo.srcObject = localStream;
        return localStream;

    } catch (err) {
        console.error("Camera error:", err);
        alert("Camera/mic is already in use or blocked");
    } finally {
        mediaStarting = false;
    }
}


// =====================================================
// 🔗 PEER CONNECTION
// =====================================================
function createPeerConnection(user) {

    if (!localStream) {
        console.warn("Media not ready yet");
        return null;
    }

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    peerConnections[user] = pc;

    pc.onicecandidate = (event) => {
        if (event.candidate) {

            //////////
 const c = event.candidate;
        const parts = c.candidate.split(" ");

        console.log("🧊 ICE Candidate:", {
            full:       c.candidate,
            type:       parts[7],        // host / srflx / relay
            protocol:   parts[2],        // UDP / TCP
            ip:         parts[4],        // IP address
            port:       parts[5],        // port
            foundation: parts[0],
        });
            ///////////
            socket.send(JSON.stringify({
                type: "ice-candidate",
                candidate: event.candidate,
                target: user
            }));
        }
    };

    pc.ontrack = (event) => {

        if (!remoteStreams[user]) {
            remoteStreams[user] = new MediaStream();
        }

        remoteStreams[user].addTrack(event.track);

        let video = document.getElementById(`video-${user}`);

        if (!video) {
            video = document.createElement("video");
            video.id = `video-${user}`;
            video.autoplay = true;
            video.playsInline = true;
            document.querySelector(".video-container").appendChild(video);
        }

        video.srcObject = remoteStreams[user];
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state with ${user}: ${pc.iceConnectionState}`);
         const c = event.candidate;
        const parts = c.candidate.split(" ");

        console.log("🧊 ICE Candidate:", {
            full:       c.candidate,
            type:       parts[7],        // host / srflx / relay
            protocol:   parts[2],        // UDP / TCP
            ip:         parts[4],        // IP address
            port:       parts[5],        // port
            foundation: parts[0],
        });
    };

    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    return pc;
}


// =====================================================
// 📞 CALL USER (FIXED)
// =====================================================
async function callUser(target) {

    if (callLock) return;
    callLock = true;
    setTimeout(() => callLock = false, 3000);

    if (peerConnections[target]) return;

    await startMedia();

    const pc = createPeerConnection(target);
    if (!pc) return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.send(JSON.stringify({
        type: "offer",
        offer,
        target
    }));

    statusDiv.innerText = `Calling ${target}...`;

    if (callControls) callControls.style.display = "flex";
}


// =====================================================
// ✅ ACCEPT CALL
// =====================================================
async function acceptCall() {

    incomingCallDiv.style.display = "none";

    if (!pendingCall) return;

    const { from, offer } = pendingCall;

    await startMedia();

    const pc = createPeerConnection(from);
    if (!pc) return;

    await pc.setRemoteDescription(offer);
    await flushIceCandidates(from);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.send(JSON.stringify({
        type: "answer",
        answer,
        target: from
    }));

    pendingCall = null;

    statusDiv.innerText = `In call with ${from}`;

    if (callControls) callControls.style.display = "flex";
}


// =====================================================
// ❌ REJECT CALL
// =====================================================
function rejectCall() {
    incomingCallDiv.style.display = "none";
    pendingCall = null;
    statusDiv.innerText = "Call rejected";
}


// =====================================================
// ❌ HANG UP
// =====================================================
function hangUp() {

    Object.values(peerConnections).forEach(pc => pc.close());

    peerConnections = {};
    remoteStreams = {};
    iceCandidateBuffer = {};

    document.querySelectorAll("video[id^='video-']").forEach(v => v.remove());

    statusDiv.innerText = "Call ended";

    if (callControls) callControls.style.display = "none";
}


// =====================================================
// 🧊 ICE BUFFER FLUSH
// =====================================================
async function flushIceCandidates(user) {

    const pc = peerConnections[user];
    const buffer = iceCandidateBuffer[user];

    if (!pc || !buffer) return;

    for (const c of buffer) {
        try {
            await pc.addIceCandidate(c);
        } catch (e) {
            console.warn("ICE error:", e);
        }
    }

    iceCandidateBuffer[user] = [];
}


// =====================================================
// 👥 USERS UI
// =====================================================
function updateUserList(users) {

    userList.innerHTML = "";

    if (!users || users.length === 0) {
        userList.innerHTML = "<li>No users in room</li>";
        return;
    }

    users.forEach(addUser);
}

function addUser(user) {

    if (user === username) return;

    const li = document.createElement("li");
    li.id = `user-${user}`;

    li.innerHTML = `
        <span>${user}</span>
        <button onclick="callUser('${user}')">Call</button>
    `;

    userList.appendChild(li);
}

function removeUser(user) {
    const el = document.getElementById(`user-${user}`);
    if (el) el.remove();
}
// =====================================================
// 🎛️ CONTROLS
// =====================================================
function toggleMute() {

    if (!localStream) return;

    const audioTracks = localStream.getAudioTracks();
    if (!audioTracks.length) return;

    const newState = !audioTracks[0].enabled;

    audioTracks.forEach(t => t.enabled = newState);

    statusDiv.innerText = newState ? "🎤 Mic ON" : "🔇 Mic OFF";
}

function toggleCamera() {

    if (!localStream) return;

    const videoTracks = localStream.getVideoTracks();
    if (!videoTracks.length) return;

    const newState = !videoTracks[0].enabled;

    videoTracks.forEach(t => t.enabled = newState);

    statusDiv.innerText = newState ? "📷 Camera ON" : "📵 Camera OFF";
}