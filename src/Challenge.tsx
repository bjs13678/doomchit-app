import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Play, RefreshCw, ArrowLeft, Smartphone, Trophy, User, Sparkles, Loader2, X, TrendingUp, Pause, Film, FastForward, Volume2, VolumeX } from 'lucide-react';
import { collection, onSnapshot, query, where, doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';

interface ChallengeRankRow { userId: string; displayName: string; max: number; }
interface TimelinePoint {
  time: number;
  score: number;
  // 그 시점의 관절 각도 차이 (사용자 - 원본, 양수면 더 펴짐)
  rE?: number; // rightElbow diff
  lE?: number; // leftElbow diff
  rK?: number; // rightKnee diff
  lK?: number; // leftKnee diff
}
interface WeakWindow { start: number; end: number; avg: number; }
interface AIImprovement { area: string; issue: string; tip: string; }
interface JointAngleSummary { user: number; target: number; diff: number; } // 각도 평균(도)
type JointAngleData = Record<string, JointAngleSummary>;
interface AIFeedback {
  summary: string;
  strengths: string[];
  improvements: AIImprovement[];
  drillRecommendation: string;
  encouragement: string;
}

// 세 점 사이 각도 (도) — p2가 꼭짓점 (관절)
const calcAngle = (p1: any, p2: any, p3: any): number => {
  if (!p1 || !p2 || !p3) return 0;
  const v1x = p1.x - p2.x, v1y = p1.y - p2.y;
  const v2x = p3.x - p2.x, v2y = p3.y - p2.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return Math.acos(cos) * 180 / Math.PI;
};

// 관절 각도 4개 (좌/우 팔꿈치, 좌/우 무릎). MediaPipe Pose 인덱스 기준.
const computeJointAngles = (lm: any) => {
  if (!lm || lm.length < 29) return null;
  return {
    rightElbow: calcAngle(lm[12], lm[14], lm[16]),  // 어깨-팔꿈치-손목
    leftElbow:  calcAngle(lm[11], lm[13], lm[15]),
    rightKnee:  calcAngle(lm[24], lm[26], lm[28]),  // 엉덩이-무릎-발목
    leftKnee:   calcAngle(lm[23], lm[25], lm[27]),
  };
};

const JOINT_LABELS_KR: Record<string, string> = {
  rightElbow: '오른팔 굽힘',
  leftElbow: '왼팔 굽힘',
  rightKnee: '오른다리 굽힘',
  leftKnee: '왼다리 굽힘',
};

const calculateScore = (targetLandmarks: any, userLandmarks: any) => {
  if (!userLandmarks || userLandmarks.length === 0) return 0;
  if (!targetLandmarks || targetLandmarks.length === 0) return 0;

  const keyJoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  
  let totalDistance = 0;
  let validJoints = 0;

  keyJoints.forEach((index) => {
    const target = targetLandmarks[index];
    const user = userLandmarks[index];

    if (target && user && target.visibility > 0.5 && user.visibility > 0.5) {
      const userMirroredX = 1 - user.x; 
      const dx = target.x - userMirroredX;
      const dy = target.y - user.y;
      
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalDistance += distance;
      validJoints++;
    }
  });

  if (validJoints === 0) return 0; 

  const avgDistance = totalDistance / validJoints;
  const maxDistance = 0.25; 
  let score = 100 - ((avgDistance / maxDistance) * 100);

  return Math.round(Math.max(0, Math.min(100, score)));
};

// 💡 챌린지 제목과 가수명을 받을 수 있도록 Props 추가
interface ClipInfo { index: number; duration: number; video_url: string; thumb_url: string; }

interface Props {
  videoUrl: string;
  playbackRate: number;
  userStickmanColor?: string;
  challengeTitle?: string;
  challengeArtist?: string;
  challengeId?: string;
  challengeMusicId?: string;
  currentUserId?: string;
  // 맞춤 연습 추천용 (clips 정보 + 클립 도전 콜백)
  clips?: ClipInfo[];
  onPracticeClip?: (clipUrl: string, speed: number) => void;
  apiUrl?: string;
  userTickets?: number;
  userIsPremium?: boolean;
  onAITutorSpend?: () => Promise<boolean>;
  onBack: () => void;
  onComplete?: (score: number) => void;
}

export default function ChallengeComponent({
  videoUrl,
  playbackRate,
  userStickmanColor = "#00FF00",
  challengeTitle = "Hype Boy",
  challengeArtist = "NewJeans",
  challengeId,
  challengeMusicId,
  currentUserId,
  clips,
  onPracticeClip,
  apiUrl,
  userTickets,
  userIsPremium,
  onAITutorSpend,
  onBack,
  onComplete
}: Props) {
  const webcamRef = useRef<Webcam>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [score, setScore] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<ChallengeRankRow[]>([]);

  // 리더보드 집계 모드: 음악이 있으면 곡 전체, 없으면 이 챌린지에 한정
  const leaderboardMode: 'music' | 'challenge' = challengeMusicId ? 'music' : 'challenge';

  useEffect(() => {
    if (!isFinished) return;
    if (!challengeMusicId && !challengeId) return;
    const filter = challengeMusicId
      ? where('musicId', '==', challengeMusicId)
      : where('challengeId', '==', challengeId!);
    const q = query(collection(db, 'submissions'), filter);
    return onSnapshot(q, snap => {
      const byUser = new Map<string, ChallengeRankRow>();
      snap.docs.forEach(d => {
        const s = d.data() as any;
        const cur = byUser.get(s.userId) || { userId: s.userId, displayName: s.displayName, max: 0 };
        if (s.score > cur.max) cur.max = s.score;
        cur.displayName = s.displayName;
        byUser.set(s.userId, cur);
      });
      setLeaderboard(Array.from(byUser.values()).sort((a, b) => b.max - a.max));
    });
  }, [isFinished, challengeId, challengeMusicId]);
  
  const [isPortrait, setIsPortrait] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [countdown, setCountdown] = useState<number | 'START' | null>(null);
  // 원본 챌린지 영상이 가로인지 (가로일 때만 모바일 회전 안내)
  const [videoIsLandscape, setVideoIsLandscape] = useState<boolean | null>(null);
  
  const isPlayingRef = useRef(false);
  const scoreDataRef = useRef({ sum: 0, count: 0 });
  const timelineRef = useRef<TimelinePoint[]>([]);
  const playStartTimeRef = useRef<number>(0);
  const lastTimelinePushRef = useRef<number>(0);
  // 관절 각도 누적 (각 관절별 user/target 합산 + 카운트)
  const jointAccumRef = useRef<Record<string, { uSum: number; tSum: number; count: number }>>({
    rightElbow: { uSum: 0, tSum: 0, count: 0 },
    leftElbow:  { uSum: 0, tSum: 0, count: 0 },
    rightKnee:  { uSum: 0, tSum: 0, count: 0 },
    leftKnee:   { uSum: 0, tSum: 0, count: 0 },
  });
  const [jointAngles, setJointAngles] = useState<JointAngleData | null>(null);

  // TTS 음성 코칭 (실시간)
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try { return localStorage.getItem('doomchit_tts') === 'on'; } catch { return false; }
  });
  const lastTtsAtRef = useRef(0);
  const TTS_COOLDOWN_MS = 5000; // 5초마다 1회 max

  const speak = (text: string) => {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 1.15;
      u.pitch = 1.0;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch {}
  };

  const generateCue = (key: string, diff: number): string => {
    const cuesPositive: Record<string, string> = {
      rightElbow: '오른팔을 좀 더 굽혀보세요',
      leftElbow: '왼팔을 좀 더 굽혀보세요',
      rightKnee: '오른쪽 무릎을 좀 더 굽혀보세요',
      leftKnee: '왼쪽 무릎을 좀 더 굽혀보세요',
    };
    const cuesNegative: Record<string, string> = {
      rightElbow: '오른팔을 좀 더 펴보세요',
      leftElbow: '왼팔을 좀 더 펴보세요',
      rightKnee: '오른쪽 무릎을 좀 더 펴보세요',
      leftKnee: '왼쪽 무릎을 좀 더 펴보세요',
    };
    return diff > 0 ? cuesPositive[key] || '자세 확인' : cuesNegative[key] || '자세 확인';
  };

  // 비교 오버레이 (녹화)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [userRecordingUrl, setUserRecordingUrl] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayPlaying, setOverlayPlaying] = useState(false);
  const [overlaySpeed, setOverlaySpeed] = useState(1.0);
  const [overlayMuted, setOverlayMuted] = useState(false);
  const overlayOriginalRef = useRef<HTMLVideoElement>(null);
  const overlayUserRef = useRef<HTMLVideoElement>(null);

  const startRecording = () => {
    try {
      if (!webcamRef.current?.video) return;
      const stream = (webcamRef.current.video as any).srcObject as MediaStream | null;
      if (!stream) return;
      // 이전 녹화본 정리
      if (userRecordingUrl) { try { URL.revokeObjectURL(userRecordingUrl); } catch {} }
      setUserRecordingUrl(null);
      recordedChunksRef.current = [];
      // 브라우저별 codec 호환
      let mime = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        if (recordedChunksRef.current.length === 0) return;
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setUserRecordingUrl(url);
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch (err) {
      console.warn('Recording start failed', err);
    }
  };

  const stopRecording = () => {
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    } catch (err) { console.warn('Recording stop failed', err); }
  };

  // 비교 오버레이 동기화
  const overlayTogglePlay = () => {
    const o = overlayOriginalRef.current, u = overlayUserRef.current;
    if (!o || !u) return;
    if (overlayPlaying) { o.pause(); u.pause(); } else { o.play(); u.play(); }
    setOverlayPlaying(!overlayPlaying);
  };

  const overlaySetSpeed = (s: number) => {
    setOverlaySpeed(s);
    if (overlayOriginalRef.current) overlayOriginalRef.current.playbackRate = s;
    if (overlayUserRef.current) overlayUserRef.current.playbackRate = s;
  };

  const overlayJumpTo = (t: number) => {
    if (overlayOriginalRef.current) overlayOriginalRef.current.currentTime = t;
    if (overlayUserRef.current) overlayUserRef.current.currentTime = t;
  };

  // 한 비디오 시킹 시 다른 쪽도 동기화
  const overlaySync = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const t = e.currentTarget.currentTime;
    const other = e.currentTarget === overlayOriginalRef.current ? overlayUserRef.current : overlayOriginalRef.current;
    if (other && Math.abs(other.currentTime - t) > 0.25) other.currentTime = t;
  };

  // AI 튜터링
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<AIFeedback | null>(null);
  const [aiError, setAiError] = useState('');
  const [showAIModal, setShowAIModal] = useState(false);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [weakWindows, setWeakWindows] = useState<WeakWindow[]>([]);

  // 시간별 약점 구간 자동 탐지 (3초 윈도우 평균 < 60)
  const detectWeakWindows = (tl: TimelinePoint[]): WeakWindow[] => {
    if (tl.length < 6) return [];
    const windows: WeakWindow[] = [];
    const WINDOW_SIZE = 6; // 0.5s × 6 = 3초
    for (let i = 0; i + WINDOW_SIZE <= tl.length; i++) {
      const slice = tl.slice(i, i + WINDOW_SIZE);
      const avg = slice.reduce((s, p) => s + p.score, 0) / slice.length;
      if (avg < 60) {
        windows.push({ start: slice[0].time, end: slice[slice.length - 1].time, avg });
      }
    }
    // 겹치는 윈도우 병합
    const merged: WeakWindow[] = [];
    for (const w of windows) {
      const last = merged[merged.length - 1];
      if (last && w.start <= last.end + 0.5) {
        last.end = Math.max(last.end, w.end);
        last.avg = Math.min(last.avg, w.avg);
      } else {
        merged.push({ ...w });
      }
    }
    return merged.sort((a, b) => a.avg - b.avg).slice(0, 3); // 가장 약한 3개
  };

  const handleRequestAITutor = async () => {
    if (!apiUrl || !onAITutorSpend) return;
    setAiBusy(true);
    setAiError('');
    try {
      const ok = await onAITutorSpend();
      if (!ok) {
        setAiError('티켓이 부족합니다. 충전 후 다시 시도해주세요.');
        setAiBusy(false);
        return;
      }
      const res = await fetch(`${apiUrl}/ai-tutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeTitle: challengeTitle,
          musicTitle: challengeArtist || null,
          score: finalScore,
          timeline: timeline,
          jointAngles: jointAngles,
          weakWindows: weakWindows,
        }),
      });
      const data = await res.json();
      if (data.feedback) {
        setAiFeedback(data.feedback);
        setShowAIModal(true);
      } else {
        setAiError(data.error || '분석 실패');
      }
    } catch (err: any) {
      setAiError('네트워크 오류: ' + err.message);
    } finally {
      setAiBusy(false);
    }
  };
  
  const userPoseRef = useRef<Pose | null>(null);
  const targetPoseRef = useRef<Pose | null>(null);
  const targetLandmarksRef = useRef<any>(null); 
  const cameraRef = useRef<Camera | null>(null);

  useEffect(() => {
    const checkMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    setIsMobile(checkMobile);

    const checkOrientation = () => setIsPortrait(window.innerHeight > window.innerWidth);
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    return () => window.removeEventListener('resize', checkOrientation);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    const targetPose = new Pose({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    targetPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    targetPose.onResults((results) => {
      targetLandmarksRef.current = results.poseLandmarks;
    });
    targetPoseRef.current = targetPose;

    const userPose = new Pose({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    userPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    userPose.onResults((results) => {
      if (!canvasRef.current || !webcamRef.current) return;
      const videoWidth = webcamRef.current.video?.videoWidth || 640;
      const videoHeight = webcamRef.current.video?.videoHeight || 480;
      canvasRef.current.width = videoWidth;
      canvasRef.current.height = videoHeight;
      
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.translate(canvasRef.current.width, 0);
      ctx.scale(-1, 1);

      if (results.poseLandmarks) {
        drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: userStickmanColor, lineWidth: 4 });
        drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2, radius: 4 });
        
        if (isPlayingRef.current) {
          const currentScore = calculateScore(targetLandmarksRef.current, results.poseLandmarks);
          setScore(currentScore);
          scoreDataRef.current.sum += currentScore;
          scoreDataRef.current.count += 1;
          // 관절 각도 계산 (사용자는 좌우 반전 mirror)
          const userMirrored = results.poseLandmarks.map((p: any) => ({ ...p, x: 1 - p.x }));
          const userAng = computeJointAngles(userMirrored);
          const targetAng = computeJointAngles(targetLandmarksRef.current);
          if (userAng && targetAng) {
            for (const key of Object.keys(userAng) as Array<keyof typeof userAng>) {
              const u = userAng[key], t = targetAng[key];
              if (u > 0 && t > 0) {
                const acc = jointAccumRef.current[key];
                acc.uSum += u;
                acc.tSum += t;
                acc.count += 1;
              }
            }
          }
          // TTS 코칭 — 큰 편차 부위 1개에 대해 5초마다 max 1회
          if (ttsEnabled && userAng && targetAng) {
            const now = Date.now();
            if (now - lastTtsAtRef.current > TTS_COOLDOWN_MS) {
              const diffs: Array<[string, number]> = [
                ['rightElbow', userAng.rightElbow - targetAng.rightElbow],
                ['leftElbow', userAng.leftElbow - targetAng.leftElbow],
                ['rightKnee', userAng.rightKnee - targetAng.rightKnee],
                ['leftKnee', userAng.leftKnee - targetAng.leftKnee],
              ];
              let maxAbs = 0;
              let pick: [string, number] | null = null;
              for (const [k, d] of diffs) {
                if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); pick = [k, d]; }
              }
              if (pick && maxAbs > 30) {
                speak(generateCue(pick[0], pick[1]));
                lastTtsAtRef.current = now;
              }
            }
          }
          // 0.5초마다 timeline에 기록 (점수 + 관절 차이)
          const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
          if (elapsed - lastTimelinePushRef.current >= 0.5) {
            const pt: TimelinePoint = { time: Number(elapsed.toFixed(2)), score: currentScore };
            if (userAng && targetAng) {
              pt.rE = Number((userAng.rightElbow - targetAng.rightElbow).toFixed(1));
              pt.lE = Number((userAng.leftElbow - targetAng.leftElbow).toFixed(1));
              pt.rK = Number((userAng.rightKnee - targetAng.rightKnee).toFixed(1));
              pt.lK = Number((userAng.leftKnee - targetAng.leftKnee).toFixed(1));
            }
            timelineRef.current.push(pt);
            lastTimelinePushRef.current = elapsed;
          }
        }
      } else {
        if (isPlayingRef.current) {
          setScore(0);
          scoreDataRef.current.sum += 0;
          scoreDataRef.current.count += 1;
          const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
          if (elapsed - lastTimelinePushRef.current >= 0.5) {
            timelineRef.current.push({ time: Number(elapsed.toFixed(2)), score: 0 });
            lastTimelinePushRef.current = elapsed;
          }
        }
      }
      ctx.restore();
    });
    userPoseRef.current = userPose;

    if (webcamRef.current && webcamRef.current.video) {
      const camera = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          try {
            const tasks = [];
            if (webcamRef.current?.video && userPoseRef.current) {
              tasks.push(userPoseRef.current.send({ image: webcamRef.current.video }));
            }
            if (videoRef.current && videoRef.current.readyState >= 2 && targetPoseRef.current && isPlayingRef.current) {
              tasks.push(targetPoseRef.current.send({ image: videoRef.current }));
            }
            await Promise.all(tasks);
          } catch (error) {
            console.error("AI 프레임 처리 오류:", error);
          }
        },
        width: 640,
        height: 480
      });
      camera.start();
      cameraRef.current = camera;
    }

    return () => {
      if (cameraRef.current) cameraRef.current.stop();
      if (targetPoseRef.current) targetPoseRef.current.close();
      if (userPoseRef.current) userPoseRef.current.close();
    };
  }, [userStickmanColor]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (countdown === null) return;
    const timer = setTimeout(() => {
      if (countdown === 3) setCountdown(2);
      else if (countdown === 2) setCountdown(1);
      else if (countdown === 1) setCountdown('START');
      else if (countdown === 'START') {
        setCountdown(null);
        if (videoRef.current) {
          videoRef.current.play();
          setIsPlaying(true);
          scoreDataRef.current = { sum: 0, count: 0 };
          timelineRef.current = [];
          lastTimelinePushRef.current = 0;
          playStartTimeRef.current = performance.now();
          // 관절 각도 누적 초기화
          jointAccumRef.current = {
            rightElbow: { uSum: 0, tSum: 0, count: 0 },
            leftElbow:  { uSum: 0, tSum: 0, count: 0 },
            rightKnee:  { uSum: 0, tSum: 0, count: 0 },
            leftKnee:   { uSum: 0, tSum: 0, count: 0 },
          };
          // 비교 오버레이용 webcam 녹화 시작
          startRecording();
        }
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleStartCountdown = () => setCountdown(3);

  const handleVideoEnd = () => {
    setIsPlaying(false);
    setIsFinished(true);
    stopRecording();
    const avgScore = scoreDataRef.current.count > 0
      ? Math.round(scoreDataRef.current.sum / scoreDataRef.current.count)
      : 0;
    setFinalScore(avgScore);
    setTimeline([...timelineRef.current]);
    setWeakWindows(detectWeakWindows(timelineRef.current));
    // 관절 각도 평균 계산
    const ja: JointAngleData = {};
    for (const [key, acc] of Object.entries(jointAccumRef.current)) {
      if (acc.count > 0) {
        const u = acc.uSum / acc.count;
        const t = acc.tSum / acc.count;
        ja[JOINT_LABELS_KR[key] || key] = {
          user: Number(u.toFixed(1)),
          target: Number(t.toFixed(1)),
          diff: Number((u - t).toFixed(1)),
        };
      }
    }
    setJointAngles(Object.keys(ja).length > 0 ? ja : null);
    setAiFeedback(null); // 매 도전마다 AI 분석 초기화
    onComplete?.(avgScore);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center justify-center">
      
      {/* 모바일 + 가로 영상 + 세로 화면일 때만 회전 안내. 세로 영상은 그대로 진행 */}
      {isMobile && isPortrait && videoIsLandscape === true && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center text-white p-8 text-center backdrop-blur-md">
          <Smartphone size={80} className="mb-6 text-[#7C5CFC] animate-pulse rotate-90 transition-all duration-1000" />
          <h2 className="text-3xl font-black mb-4 tracking-tight">화면을 눕혀주세요!</h2>
          <p className="text-lg text-white/70 font-bold mb-2">이 챌린지는 가로 영상이라</p>
          <p className="text-lg text-white/70 font-bold">기기를 눕혀야 크고 정확하게 챌린지 가능 🚀</p>
        </div>
      )}
      {/* 가로 화면 + 세로 영상일 때 — 화면을 세로로 돌려달라는 안내 (선택적) */}
      {isMobile && !isPortrait && videoIsLandscape === false && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center text-white p-8 text-center backdrop-blur-md">
          <Smartphone size={80} className="mb-6 text-[#7C5CFC] animate-pulse transition-all duration-1000" />
          <h2 className="text-3xl font-black mb-4 tracking-tight">화면을 세워주세요!</h2>
          <p className="text-lg text-white/70 font-bold mb-2">이 챌린지는 세로 영상이라</p>
          <p className="text-lg text-white/70 font-bold">기기를 세워야 잘 보입니다 📱</p>
        </div>
      )}

      <Webcam ref={webcamRef} className="absolute inset-0 w-full h-full object-contain bg-black -scale-x-100" muted playsInline />
      
      <video
        ref={videoRef}
        src={videoUrl}
        crossOrigin="anonymous"
        className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-500 ${(isPlaying || countdown !== null) ? 'opacity-40' : 'opacity-0'}`}
        onEnded={handleVideoEnd}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth > 0 && v.videoHeight > 0) {
            setVideoIsLandscape(v.videoWidth > v.videoHeight);
          }
        }}
        playsInline
        preload="auto"
      />
      
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10" />

      {countdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm">
          <span key={countdown} className={`font-black text-white drop-shadow-[0_0_40px_rgba(124,92,252,0.8)] animate-pulse ${countdown === 'START' ? 'text-8xl md:text-[150px] text-[#7C5CFC]' : 'text-[150px] md:text-[250px]'}`}>
            {countdown}
          </span>
        </div>
      )}

      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-center z-40 bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={onBack} className="text-white bg-black/50 p-3 rounded-full hover:bg-[#7C5CFC] hover:text-white transition-all">
          <ArrowLeft size={24} />
        </button>
        {isPlaying && (
          <div className="flex flex-col items-end">
            <span className="text-white/70 text-sm font-bold tracking-widest mb-1">SCORE</span>
            <span className={`text-5xl font-black tabular-nums tracking-tighter ${score > 85 ? 'text-[#7C5CFC] drop-shadow-[0_0_15px_rgba(124,92,252,0.5)]' : 'text-white'}`}>
              {score}
            </span>
          </div>
        )}
      </div>

      {!isPlaying && !isFinished && countdown === null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/40 backdrop-blur-sm gap-6">
          <button onClick={handleStartCountdown} className="group relative flex flex-col items-center hover:scale-110 transition-transform">
            <div className="bg-[#7C5CFC] rounded-full p-8 shadow-[0_0_40px_rgba(124,92,252,0.4)] group-hover:shadow-[0_0_60px_rgba(124,92,252,0.6)] transition-all">
              <Play fill="white" stroke="white" size={48} className="ml-2" />
            </div>
            <span className="mt-6 text-white font-black tracking-widest text-xl drop-shadow-lg">CHALLENGE START</span>
          </button>
          {/* TTS 음성 코칭 토글 */}
          <button
            onClick={() => {
              const next = !ttsEnabled;
              setTtsEnabled(next);
              try { localStorage.setItem('doomchit_tts', next ? 'on' : 'off'); } catch {}
              if (next) speak('음성 코칭 켜짐');
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-black transition-all ${ttsEnabled ? 'bg-[#7C5CFC] text-white' : 'bg-white/10 text-white/60'}`}
          >
            {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            음성 코칭 {ttsEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      {/* 💡 [핵심 추가] 결과 화면 + 개별곡 랭킹 UI */}
      {isFinished && (
        <div className="absolute inset-0 z-50 bg-black/95 flex flex-col items-center justify-start pt-16 px-6 gap-6 backdrop-blur-xl overflow-y-auto pb-24">
          <h2 className="text-3xl font-black text-white/80 tracking-widest mt-4">최종 스코어</h2>
          <p className={`text-9xl font-black ${finalScore > 80 ? 'text-green-400' : finalScore > 50 ? 'text-yellow-400' : 'text-red-400'}`}>
            {finalScore}
          </p>
          <p className="text-white/60 font-bold text-lg mb-4">
            {finalScore > 80 ? "완벽합니다! 댄스 마스터 🕺" : finalScore > 50 ? "아주 좋아요! 조금만 더 연습해볼까요? ✨" : "포기하지 마세요! 다시 도전! 🔥"}
          </p>
          
          <div className="flex gap-4 w-full max-w-md mb-4">
            <button onClick={() => { setIsFinished(false); scoreDataRef.current = {sum:0, count:0}; setScore(0); }} className="flex-1 bg-white/10 text-white py-4 rounded-2xl font-black text-lg flex justify-center items-center gap-2 hover:bg-white/20 transition-all">
              <RefreshCw size={24} /> 다시 하기
            </button>
            <button onClick={onBack} className="flex-1 bg-[#7C5CFC] text-white py-4 rounded-2xl font-black text-lg hover:opacity-90 transition-all shadow-[0_0_20px_rgba(124,92,252,0.4)]">
              목록으로
            </button>
          </div>

          {/* 비교 오버레이 버튼 (녹화본 있을 때만) */}
          {userRecordingUrl && (
            <button
              onClick={() => setShowOverlay(true)}
              className="w-full max-w-md mb-4 bg-white/10 hover:bg-white/20 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-3 transition-all"
            >
              <Film size={20} className="text-[#7C5CFC]" />
              <span>비교 영상 보기 (원본 vs 너)</span>
            </button>
          )}

          {/* AI 튜터링 버튼 */}
          {apiUrl && onAITutorSpend && (
            <div className="w-full max-w-md mb-6">
              {!aiFeedback ? (
                <button
                  onClick={handleRequestAITutor}
                  disabled={aiBusy || (!userIsPremium && (userTickets ?? 0) < 1)}
                  className="w-full bg-gradient-to-r from-[#7C5CFC] via-[#9B7FFF] to-[#D8D8EC] text-black py-5 rounded-2xl font-black flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(124,92,252,0.5)] hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiBusy ? <><Loader2 className="animate-spin" size={20} /> Gemini 분석 중...</> : (
                    <>
                      <Sparkles size={22} />
                      <span>AI 정밀 분석 받기</span>
                      <span className="text-xs bg-black/20 px-2 py-1 rounded-full">
                        {userIsPremium ? '🔓 무제한' : `🎟️ 1티켓 (잔액 ${userTickets ?? 0})`}
                      </span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => setShowAIModal(true)}
                  className="w-full bg-white/10 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-white/20 transition-all"
                >
                  <Sparkles size={20} /> AI 분석 결과 다시 보기
                </button>
              )}
              {aiError && <p className="text-red-400 text-xs font-bold mt-2 text-center">{aiError}</p>}
              {!userIsPremium && (userTickets ?? 0) < 1 && !aiFeedback && (
                <p className="text-white/50 text-xs font-bold mt-2 text-center">티켓이 부족합니다 — 헤더 🎟️ 클릭해서 충전</p>
              )}
            </div>
          )}

          {/* 관절 각도 분석 (무료) */}
          {jointAngles && (
            <div className="w-full max-w-md bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-4">
              <h3 className="font-black text-white mb-3 flex items-center gap-2">
                💪 부위별 자세 분석
              </h3>
              <div className="space-y-2">
                {Object.entries(jointAngles).map(([name, d]) => {
                  const absDiff = Math.abs(d.diff);
                  const status = absDiff < 10 ? '완벽' : absDiff < 25 ? '양호' : '편차 큼';
                  const color = absDiff < 10 ? 'text-green-400' : absDiff < 25 ? 'text-yellow-400' : 'text-red-400';
                  const direction = d.diff > 0 ? '더 펴짐' : d.diff < 0 ? '더 굽힘' : '동일';
                  return (
                    <div key={name} className="flex items-center justify-between bg-white/5 rounded-xl p-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-white text-sm font-bold truncate">{name}</span>
                        <span className={`text-xs font-black ${color}`}>{status}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-white/60">{d.user.toFixed(0)}° vs {d.target.toFixed(0)}°</p>
                        <p className={`text-xs font-bold ${color}`}>{d.diff > 0 ? '+' : ''}{d.diff.toFixed(1)}° ({direction})</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 맞춤 연습 추천 — 약점 구간을 클립 인덱스에 매핑 */}
          {weakWindows.length > 0 && clips && clips.length > 1 && onPracticeClip && (() => {
            // 클립별 누적 시작/끝 시간 계산 (클립이 순차적으로 이어진다고 가정)
            const clipRanges: Array<{ clip: ClipInfo; start: number; end: number }> = [];
            let cum = 0;
            for (const c of clips) {
              clipRanges.push({ clip: c, start: cum, end: cum + c.duration });
              cum += c.duration;
            }
            // 약점 구간 → 가장 많이 겹치는 클립
            const recos = weakWindows.map(w => {
              let best = clipRanges[0];
              let bestOverlap = 0;
              for (const r of clipRanges) {
                const overlap = Math.max(0, Math.min(w.end, r.end) - Math.max(w.start, r.start));
                if (overlap > bestOverlap) {
                  bestOverlap = overlap;
                  best = r;
                }
              }
              return { window: w, clip: best.clip };
            });
            // 같은 클립 중복 제거
            const seen = new Set<number>();
            const uniqueRecos = recos.filter(r => {
              if (seen.has(r.clip.index)) return false;
              seen.add(r.clip.index);
              return true;
            });
            return (
              <div className="w-full max-w-md bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-4">
                <h3 className="font-black text-white mb-1 flex items-center gap-2">
                  🎯 맞춤 연습 추천
                </h3>
                <p className="text-xs text-white/50 font-bold mb-3">약점 구간이 포함된 클립 — 0.5배속으로 천천히 다시 도전</p>
                <div className="space-y-2">
                  {uniqueRecos.map(({ window, clip }) => (
                    <div key={clip.index} className="flex items-center gap-3 bg-white/5 rounded-2xl p-3">
                      <img src={clip.thumb_url.startsWith('http') ? clip.thumb_url : `${apiUrl}${clip.thumb_url}`} className="w-14 h-14 rounded-lg object-cover bg-black/40" alt="" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-sm">동작 #{clip.index}</p>
                        <p className="text-white/60 text-xs font-bold">정확도 {Math.round(window.avg)}% · {window.start.toFixed(1)}~{window.end.toFixed(1)}초</p>
                      </div>
                      <button
                        onClick={() => onPracticeClip(clip.video_url, 0.5)}
                        className="bg-[#7C5CFC] text-white px-3 py-2 rounded-xl text-xs font-black hover:bg-[#684be0] active:scale-95"
                      >
                        🐢 0.5x 연습
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 시간별 점수 차트 (무료, 항상 표시) */}
          {timeline.length > 0 && (
            <div className="w-full max-w-md bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="text-[#7C5CFC]" size={20} />
                <h3 className="font-black text-white">시간별 점수</h3>
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeline}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#888' }} unit="s" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#888' }} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.[0]) return null;
                        const d: TimelinePoint = payload[0].payload;
                        const rows: Array<[string, number | undefined]> = [
                          ['오른팔', d.rE], ['왼팔', d.lE], ['오른다리', d.rK], ['왼다리', d.lK],
                        ];
                        return (
                          <div className="bg-black/90 rounded-lg p-3 text-xs border border-white/10">
                            <p className="font-black text-white mb-1">⏱ {d.time.toFixed(1)}초 — 점수 {d.score}</p>
                            {rows.map(([name, v]) =>
                              v !== undefined ? (
                                <p key={name} className="text-white/80">
                                  {name}: <span className={Math.abs(v) > 25 ? 'text-red-400 font-bold' : Math.abs(v) > 10 ? 'text-yellow-300' : 'text-green-300'}>
                                    {v > 0 ? '+' : ''}{v.toFixed(0)}°
                                  </span>
                                </p>
                              ) : null
                            )}
                          </div>
                        );
                      }}
                    />
                    <Line type="monotone" dataKey="score" stroke="#7C5CFC" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    {weakWindows.map((w, i) => (
                      <ReferenceArea key={i} x1={w.start} x2={w.end} fill="#FF4444" fillOpacity={0.15} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-white/40 mt-1 text-center">차트 위에 마우스/터치 — 그 순간 관절 각도 차이 확인</p>
              {weakWindows.length > 0 && (
                <p className="text-xs font-bold text-red-300/80 mt-2">⚠️ 빨간 구간이 약점 — 반복 연습 추천</p>
              )}
            </div>
          )}

          {/* 현재 챌린지/곡의 랭킹 표시 영역 (실데이터) */}
          <div className="w-full max-w-md bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="text-yellow-400" size={24} />
              <h3 className="text-xl font-black text-white">
                {leaderboardMode === 'music' ? '이 곡의 랭킹' : '이 챌린지의 랭킹'}
              </h3>
            </div>

            <div className="p-4 border-l-4 border-[#7C5CFC] bg-white/5 rounded-r-2xl mb-5">
              <p className="text-xs text-[#7C5CFC] font-bold">
                {leaderboardMode === 'music' ? '현재 곡 (모든 챌린지 통합)' : '현재 챌린지 (이 영상만)'}
              </p>
              <p className="font-black text-lg text-white">{challengeTitle}{challengeArtist ? ` — ${challengeArtist}` : ''}</p>
            </div>

            {(() => {
              const myRank = currentUserId ? leaderboard.findIndex(r => r.userId === currentUserId) + 1 : 0;
              const myRow = currentUserId ? leaderboard.find(r => r.userId === currentUserId) : null;
              const top5 = leaderboard.slice(0, 5);
              const myInTop = myRank > 0 && myRank <= 5;

              if (leaderboard.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-8 gap-3 text-white/40">
                    <Trophy size={36} strokeWidth={1.2} />
                    <p className="font-bold text-center text-sm">집계 중...<br />당신이 첫 도전자가 될 수도 있어요!</p>
                  </div>
                );
              }

              return (
                <>
                  {/* 본인 순위 — 상단 강조 (TOP 5 안에 있어도 별도 표시) */}
                  {myRow && (
                    <div className="mb-4 p-4 bg-[#7C5CFC]/20 border-2 border-[#7C5CFC] rounded-2xl">
                      <p className="text-xs text-[#7C5CFC] font-black tracking-widest mb-2">YOUR RANK</p>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#7C5CFC] flex items-center justify-center font-black text-white text-lg">
                          {myRank}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white truncate">{myRow.displayName} <span className="text-xs text-[#D8D8EC]">(나)</span></p>
                          <p className="text-xs text-white/70 font-bold">최고 {myRow.max}점 · 전체 {leaderboard.length}명 중 {myRank}위</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TOP 5 */}
                  <div className="space-y-2">
                    {top5.map((row, i) => {
                      const rank = i + 1;
                      const isMe = row.userId === currentUserId;
                      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
                      const rankColor = rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-500' : 'text-white/70';
                      return (
                        <div key={row.userId} className={`flex items-center gap-3 p-3 rounded-2xl ${isMe ? 'bg-[#7C5CFC]/15 border border-[#7C5CFC]/40' : 'bg-white/5'}`}>
                          <div className="flex items-center justify-center w-9">
                            {medal ? <span className="text-2xl">{medal}</span> : <span className={`text-lg font-black ${rankColor}`}>{rank}</span>}
                          </div>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-white ${isMe ? 'bg-[#7C5CFC]' : 'bg-gradient-to-br from-gray-500 to-gray-600'}`}>
                            {row.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-bold truncate ${isMe ? 'text-[#D8D8EC]' : 'text-white'}`}>
                              {row.displayName}{isMe && <span className="text-xs ml-1">(나)</span>}
                            </p>
                            <p className="text-xs text-white/50 font-bold">최고 {row.max}점</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {leaderboard.length > 5 && !myInTop && (
                    <p className="text-center text-xs text-white/40 mt-3 font-bold">
                      ⋯ 외 {leaderboard.length - 5}명
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* 비교 오버레이 모달 */}
      {showOverlay && userRecordingUrl && (
        <div className="fixed inset-0 z-[200] bg-black flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h3 className="text-white font-black text-lg flex items-center gap-2">
              <Film size={20} className="text-[#7C5CFC]" /> 비교 영상
            </h3>
            <button onClick={() => { setShowOverlay(false); setOverlayPlaying(false); overlayOriginalRef.current?.pause(); overlayUserRef.current?.pause(); }} className="text-white/60 hover:text-white">
              <X size={24} />
            </button>
          </div>

          {/* 분할 화면 */}
          <div className="flex-1 grid grid-rows-2 md:grid-rows-1 md:grid-cols-2 gap-1 p-2 min-h-0">
            <div className="relative bg-black rounded-xl overflow-hidden">
              <video
                ref={overlayOriginalRef}
                src={videoUrl}
                crossOrigin="anonymous"
                className="absolute inset-0 w-full h-full object-contain"
                onTimeUpdate={overlaySync}
                onEnded={() => setOverlayPlaying(false)}
                muted={overlayMuted}
                playsInline
              />
              <span className="absolute top-2 left-2 bg-[#7C5CFC] text-white text-xs font-black px-2 py-1 rounded">원본</span>
            </div>
            <div className="relative bg-black rounded-xl overflow-hidden">
              <video
                ref={overlayUserRef}
                src={userRecordingUrl}
                className="absolute inset-0 w-full h-full object-contain -scale-x-100"
                onTimeUpdate={overlaySync}
                muted
                playsInline
              />
              <span className="absolute top-2 left-2 bg-green-500 text-black text-xs font-black px-2 py-1 rounded">너</span>
            </div>
          </div>

          {/* 컨트롤 + 약점 구간 점프 */}
          <div className="border-t border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={overlayTogglePlay}
                className="w-14 h-14 rounded-full bg-[#7C5CFC] text-white flex items-center justify-center hover:bg-[#684be0] active:scale-95"
              >
                {overlayPlaying ? <Pause size={24} /> : <Play size={24} className="ml-0.5" fill="currentColor" />}
              </button>
              <div className="flex bg-white/5 rounded-full p-1">
                {[0.25, 0.5, 1.0].map(s => (
                  <button
                    key={s}
                    onClick={() => overlaySetSpeed(s)}
                    className={`px-3 py-1.5 rounded-full text-xs font-black transition-all ${overlaySpeed === s ? 'bg-white text-black' : 'text-white/60'}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <button
                onClick={() => setOverlayMuted(!overlayMuted)}
                className="w-10 h-10 rounded-full bg-white/5 text-white/70 flex items-center justify-center hover:bg-white/10"
              >
                {overlayMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>

            {weakWindows.length > 0 && (
              <div>
                <p className="text-xs font-black text-red-400 mb-2 text-center">⚠️ 약점 구간으로 점프</p>
                <div className="flex gap-2 overflow-x-auto justify-center">
                  {weakWindows.map((w, i) => (
                    <button
                      key={i}
                      onClick={() => { overlayJumpTo(w.start); overlaySetSpeed(0.5); if (!overlayPlaying) overlayTogglePlay(); }}
                      className="bg-red-500/20 text-red-300 hover:bg-red-500/30 px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap flex items-center gap-1"
                    >
                      <FastForward size={12} /> {w.start.toFixed(1)}~{w.end.toFixed(1)}s ({Math.round(w.avg)}%)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI 튜터링 결과 모달 */}
      {showAIModal && aiFeedback && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setShowAIModal(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div onClick={(e) => e.stopPropagation()} className="relative bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1a] border border-[#7C5CFC]/30 rounded-3xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-gradient-to-b from-[#1a1a2e] to-[#1a1a2e]/95 backdrop-blur-md p-5 flex items-center justify-between border-b border-white/10 z-10">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <Sparkles className="text-[#7C5CFC]" size={20} /> AI 정밀 분석
              </h3>
              <button onClick={() => setShowAIModal(false)} className="text-white/50 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* 종합 평가 */}
              <div className="bg-[#7C5CFC]/15 rounded-2xl p-4 border border-[#7C5CFC]/30">
                <p className="text-xs font-black text-[#D8D8EC] mb-2 tracking-widest">SUMMARY</p>
                <p className="text-white font-bold text-base leading-relaxed">{aiFeedback.summary}</p>
              </div>

              {/* 잘한 점 */}
              {aiFeedback.strengths && aiFeedback.strengths.length > 0 && (
                <div>
                  <p className="text-xs font-black text-green-400 mb-2 tracking-widest">✅ 잘한 점</p>
                  <ul className="space-y-1">
                    {aiFeedback.strengths.map((s, i) => (
                      <li key={i} className="text-white/90 text-sm font-bold flex gap-2">
                        <span className="text-green-400">·</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 개선점 */}
              {aiFeedback.improvements && aiFeedback.improvements.length > 0 && (
                <div>
                  <p className="text-xs font-black text-yellow-400 mb-2 tracking-widest">💪 개선점</p>
                  <div className="space-y-2">
                    {aiFeedback.improvements.map((imp, i) => (
                      <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                        <p className="text-yellow-300 text-xs font-black mb-1">{imp.area}</p>
                        <p className="text-white/90 text-sm font-bold mb-1">{imp.issue}</p>
                        <p className="text-white/60 text-xs">💡 {imp.tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 추천 연습 */}
              {aiFeedback.drillRecommendation && (
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <p className="text-xs font-black text-[#D8D8EC] mb-2 tracking-widest">🎯 추천 연습</p>
                  <p className="text-white/90 text-sm leading-relaxed">{aiFeedback.drillRecommendation}</p>
                </div>
              )}

              {/* 격려 */}
              {aiFeedback.encouragement && (
                <div className="text-center py-3">
                  <p className="text-[#D8D8EC] font-black text-base">{aiFeedback.encouragement}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
