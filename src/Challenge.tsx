import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Play, RefreshCw, ArrowLeft, Smartphone, Trophy } from 'lucide-react';

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
  onBack: () => void;
}

// 💡 완료 화면에 띄울 개별곡 랭킹 더미 데이터
const DUMMY_SONG_RANKING = [
  { id: 1, rank: 1, name: "춤신춤왕", maxScore: 99, profilePic: "https://i.pravatar.cc/150?u=a" },
  { id: 2, rank: 2, name: "둠칫마스터", maxScore: 95, profilePic: "https://i.pravatar.cc/150?u=b" },
  { id: 3, rank: 3, name: "리듬타는라이언", maxScore: 88, profilePic: "https://i.pravatar.cc/150?u=c" },
];

export default function ChallengeComponent({ 
  videoUrl, 
  playbackRate, 
  userStickmanColor = "#00FF00", 
  challengeTitle = "Hype Boy", 
  challengeArtist = "NewJeans", 
  onBack 
}: Props) {
  const webcamRef = useRef<Webcam>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [score, setScore] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  
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

          {/* 현재 곡의 랭킹 표시 영역 */}
          <div className="w-full max-w-md bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="text-yellow-400" size={24} />
              <h3 className="text-xl font-black text-white">이 챌린지의 랭킹</h3>
            </div>
            
            <div className="p-4 border-l-4 border-[#7C5CFC] bg-white/5 rounded-r-2xl mb-4">
              <p className="text-xs text-[#7C5CFC] font-bold">현재 진행한 곡</p>
              <p className="font-black text-lg text-white">{challengeTitle} - {challengeArtist}</p>
            </div>

            <div className="space-y-3">
              {DUMMY_SONG_RANKING.map((user) => (
                <div key={user.id} className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl">
                  <div className="flex flex-col items-center w-6">
                    <span className={`text-xl font-black ${user.rank === 1 ? 'text-yellow-400' : user.rank === 2 ? 'text-gray-300' : user.rank === 3 ? 'text-amber-600' : 'text-white'}`}>
                      {user.rank}
                    </span>
                  </div>
                  <img src={user.profilePic} className="w-12 h-12 rounded-full border border-white/20" alt="profile" />
                  <div className="flex-1">
                    <p className="font-bold text-lg text-white">{user.name}</p>
                    <p className="text-xs text-[#7C5CFC] font-bold">최고 점수 {user.maxScore}점</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
