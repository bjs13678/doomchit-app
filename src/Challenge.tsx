import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Play, RefreshCw, ArrowLeft, Smartphone, Trophy, User } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';

interface ChallengeRankRow { userId: string; displayName: string; max: number; }

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
  
  const isPlayingRef = useRef(false);
  const scoreDataRef = useRef({ sum: 0, count: 0 });
  
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
        }
      } else {
        if (isPlayingRef.current) {
          setScore(0);
          scoreDataRef.current.sum += 0;
          scoreDataRef.current.count += 1;
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
    onComplete?.(avgScore);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center justify-center">
      
      {isMobile && isPortrait && (
        <div className="absolute inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center text-white p-8 text-center backdrop-blur-md">
          <Smartphone size={80} className="mb-6 text-[#7C5CFC] animate-pulse rotate-90 transition-all duration-1000" />
          <h2 className="text-3xl font-black mb-4 tracking-tight">화면을 눕혀주세요!</h2>
          <p className="text-lg text-white/70 font-bold mb-2">가로 영상은 기기를 눕혀야</p>
          <p className="text-lg text-white/70 font-bold">크고 정확하게 챌린지할 수 있습니다 🚀</p>
        </div>
      )}

      <Webcam ref={webcamRef} className="absolute inset-0 w-full h-full object-contain bg-black -scale-x-100" muted playsInline />
      
      <video ref={videoRef} src={videoUrl} crossOrigin="anonymous" className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-500 ${(isPlaying || countdown !== null) ? 'opacity-40' : 'opacity-0'}`} onEnded={handleVideoEnd} playsInline preload="auto" />
      
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
          
          <div className="flex gap-4 w-full max-w-md mb-6">
            <button onClick={() => { setIsFinished(false); scoreDataRef.current = {sum:0, count:0}; setScore(0); }} className="flex-1 bg-white/10 text-white py-4 rounded-2xl font-black text-lg flex justify-center items-center gap-2 hover:bg-white/20 transition-all">
              <RefreshCw size={24} /> 다시 하기
            </button>
            <button onClick={onBack} className="flex-1 bg-[#7C5CFC] text-white py-4 rounded-2xl font-black text-lg hover:opacity-90 transition-all shadow-[0_0_20px_rgba(124,92,252,0.4)]">
              목록으로
            </button>
          </div>

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
    </div>
  );
}
