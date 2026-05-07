import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Play, RefreshCw, ArrowLeft, Smartphone, Trophy, User, Sparkles, Loader2, X, TrendingUp } from 'lucide-react';
import { collection, onSnapshot, query, where, doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';

interface ChallengeRankRow { userId: string; displayName: string; max: number; }
interface TimelinePoint { time: number; score: number; }
interface WeakWindow { start: number; end: number; avg: number; }
interface AIImprovement { area: string; issue: string; tip: string; }
interface AIFeedback {
  summary: string;
  strengths: string[];
  improvements: AIImprovement[];
  drillRecommendation: string;
  encouragement: string;
}

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
interface Props {
  videoUrl: string;
  playbackRate: number;
  userStickmanColor?: string;
  challengeTitle?: string;  // 추가: 챌린지 제목
  challengeArtist?: string; // 추가: 가수명 (또는 홈트 등)
  challengeId?: string;     // 이 챌린지 ID (음악 없는 경우 리더보드 필터)
  challengeMusicId?: string; // 챌린지의 음악 ID (있으면 곡 단위로 리더보드 집계)
  currentUserId?: string;   // 본인 강조용
  // AI 튜터링용
  apiUrl?: string;
  userTickets?: number;
  userIsPremium?: boolean;
  onAITutorSpend?: () => Promise<boolean>; // 티켓 차감 (premium이면 차감 X). 성공 시 true
  onBack: () => void;
  onComplete?: (score: number) => void; // 챌린지 완료 시 점수 콜백
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
          // 0.5초마다 timeline에 기록
          const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
          if (elapsed - lastTimelinePushRef.current >= 0.5) {
            timelineRef.current.push({ time: Number(elapsed.toFixed(2)), score: currentScore });
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
        }
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleStartCountdown = () => setCountdown(3);

  const handleVideoEnd = () => {
    setIsPlaying(false);
    setIsFinished(true);
    const avgScore = scoreDataRef.current.count > 0
      ? Math.round(scoreDataRef.current.sum / scoreDataRef.current.count)
      : 0;
    setFinalScore(avgScore);
    setTimeline([...timelineRef.current]);
    setWeakWindows(detectWeakWindows(timelineRef.current));
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
        <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/40 backdrop-blur-sm">
          <button onClick={handleStartCountdown} className="group relative flex flex-col items-center hover:scale-110 transition-transform">
            <div className="bg-[#7C5CFC] rounded-full p-8 shadow-[0_0_40px_rgba(124,92,252,0.4)] group-hover:shadow-[0_0_60px_rgba(124,92,252,0.6)] transition-all">
              <Play fill="white" stroke="white" size={48} className="ml-2" />
            </div>
            <span className="mt-6 text-white font-black tracking-widest text-xl drop-shadow-lg">CHALLENGE START</span>
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

          {/* 시간별 점수 차트 (무료, 항상 표시) */}
          {timeline.length > 0 && (
            <div className="w-full max-w-md bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="text-[#7C5CFC]" size={20} />
                <h3 className="font-black text-white">시간별 점수</h3>
              </div>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeline}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#888' }} unit="s" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#888' }} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: 'none', borderRadius: 8 }} />
                    <Line type="monotone" dataKey="score" stroke="#7C5CFC" strokeWidth={2} dot={false} />
                    {weakWindows.map((w, i) => (
                      <ReferenceArea key={i} x1={w.start} x2={w.end} fill="#FF4444" fillOpacity={0.15} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
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
