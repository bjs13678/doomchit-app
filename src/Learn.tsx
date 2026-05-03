import { useState, useRef, useEffect } from 'react';
import { Play, ChevronLeft, ChevronRight, ArrowLeft, Trophy, GraduationCap, Send, MessageCircle } from 'lucide-react';
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

interface Clip {
  index: number;
  duration: number;
  video_url: string;
  thumb_url: string;
}

interface Comment {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: any;
}

interface Props {
  clips: Clip[];
  jobId: string;
  apiUrl: string;
  fullVideoUrl?: string;
  challengeId?: string;       // 댓글용
  currentUserId?: string;     // 댓글 작성자 표시 + 본인 댓글 삭제
  currentDisplayName?: string;
  onStartChallenge: (clipUrl: string, speed: number) => void;
  onBack: () => void;
}

// Firebase Storage 절대 URL 또는 백엔드 상대 경로를 모두 처리
const resolveUrl = (apiUrl: string, url: string) => url.startsWith('http') ? url : `${apiUrl}${url}`;

const SPEEDS = [
  { label: '매우 쉬움', rate: 0.5 },
  { label: '쉬움', rate: 0.75 },
  { label: '기본', rate: 1.0 },
  { label: '빠름', rate: 1.25 },
  { label: '매우 빠름', rate: 1.5 },
];

export default function Learn({ clips, jobId, apiUrl, fullVideoUrl, challengeId, currentUserId, currentDisplayName, onStartChallenge, onBack }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const videoRef = useRef<HTMLVideoElement>(null);
  // 클립이 2개 이상일 때만 미리보기 단계 노출 (단일 클립은 미리보기 = 본영상이라 중복)
  const [phase, setPhase] = useState<'preview' | 'practice'>(clips.length > 1 ? 'preview' : 'practice');
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // 댓글 상태
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    if (!challengeId) return;
    const q = query(collection(db, 'challenges', challengeId, 'comments'), orderBy('timestamp', 'desc'));
    return onSnapshot(q, snap => setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Comment))));
  }, [challengeId]);

  const handlePostComment = async () => {
    const text = commentText.trim();
    if (!text || !challengeId || !currentUserId) return;
    setPostingComment(true);
    try {
      await addDoc(collection(db, 'challenges', challengeId, 'comments'), {
        userId: currentUserId,
        displayName: currentDisplayName || currentUserId,
        text,
        timestamp: serverTimestamp(),
      });
      setCommentText('');
    } catch (err) {
      alert('댓글 등록 실패: ' + err);
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = async (cid: string) => {
    if (!challengeId) return;
    if (!confirm('댓글을 삭제할까요?')) return;
    try { await deleteDoc(doc(db, 'challenges', challengeId, 'comments', cid)); } catch {}
  };

  useEffect(() => {
    if (previewVideoRef.current) previewVideoRef.current.playbackRate = playbackRate;
  }, [playbackRate, phase]);

  // 연습 모드 비디오의 배속 적용 (early return 위에 있어야 hook 순서 일관됨)
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const togglePreviewPlay = () => {
    if (!previewVideoRef.current) return;
    if (isPlaying) {
      previewVideoRef.current.pause();
      setIsPlaying(false);
    } else {
      previewVideoRef.current.play();
      setIsPlaying(true);
    }
  };

  if (phase === 'preview') {
    const previewUrl = fullVideoUrl ?? `/full-video/${jobId}`;
    return (
      <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-between py-10 px-4">
        <div className="w-full flex justify-between items-center mb-6">
          <button onClick={onBack} className="text-white p-2"><ArrowLeft size={28} /></button>
          <div className="text-white font-bold tracking-widest text-sm flex items-center gap-2">
            <span className="text-[#7C5CFC]">PREVIEW</span>
            <span className="text-white/30">전체 미리보기</span>
          </div>
          <div className="w-10" />
        </div>

        <div className="w-full max-w-sm mb-6">
          <p className="text-xs font-bold text-zinc-500 mb-2 px-1">재생 속도</p>
          <div className="flex justify-between items-center bg-zinc-900 rounded-2xl p-2">
            {SPEEDS.map((speed) => (
              <button
                key={speed.label}
                onClick={() => setPlaybackRate(speed.rate)}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                  playbackRate === speed.rate ? 'bg-white text-black shadow-md' : 'text-zinc-500 hover:text-white'
                }`}
              >{speed.label}</button>
            ))}
          </div>
        </div>

        <div className="relative w-full max-w-sm aspect-[9/16] bg-black rounded-3xl overflow-hidden shadow-2xl flex-1 mb-8">
          <video
            ref={previewVideoRef}
            src={resolveUrl(apiUrl, previewUrl)}
            className="w-full h-full object-contain bg-black"
            onEnded={() => setIsPlaying(false)}
            playsInline
            onClick={togglePreviewPlay}
          />
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm cursor-pointer pointer-events-none">
              <div className="bg-white/20 p-5 rounded-full backdrop-blur-md">
                <Play size={40} className="text-white fill-white ml-1" />
              </div>
            </div>
          )}
        </div>

        <div className="w-full max-w-sm space-y-3 shrink-0">
          <button
            onClick={() => { setPhase('practice'); setIsPlaying(false); setCurrentIndex(0); }}
            className="w-full py-5 font-black text-lg rounded-2xl flex items-center justify-center gap-3 bg-white text-black hover:bg-gray-200 transition-all"
          >
            <GraduationCap size={24} /> 단계별 연습 시작
          </button>
          <button
            onClick={() => onStartChallenge(previewUrl, playbackRate)}
            className="w-full py-4 font-black text-sm rounded-2xl flex items-center justify-center gap-2 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 transition-all"
          >
            <Play fill="currentColor" size={16} /> 연습 건너뛰고 바로 도전
          </button>
          {challengeId && (
            <button
              onClick={() => setShowComments(true)}
              className="w-full py-3 font-black text-sm rounded-2xl flex items-center justify-center gap-2 text-zinc-400 hover:text-white transition-all"
            >
              <MessageCircle size={18} /> 댓글 {comments.length}
            </button>
          )}
        </div>

        {/* 댓글 바텀 시트 */}
        {showComments && challengeId && (
          <div className="fixed inset-0 z-[300] flex flex-col" onClick={() => setShowComments(false)}>
            <div className="flex-1 bg-black/60 backdrop-blur-sm" />
            <div onClick={(e) => e.stopPropagation()} className="bg-zinc-950 border-t border-zinc-800 rounded-t-3xl flex flex-col max-h-[75vh]">
              <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                <h3 className="text-white font-black text-lg flex items-center gap-2">
                  <MessageCircle size={20} /> 댓글 {comments.length}
                </h3>
                <button onClick={() => setShowComments(false)} className="text-zinc-500 hover:text-white">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {comments.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600">
                    <MessageCircle size={36} className="mx-auto mb-2" />
                    <p className="font-bold text-sm">첫 댓글을 남겨보세요!</p>
                  </div>
                ) : comments.map(c => (
                  <div key={c.id} className="flex gap-3 group">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#D8D8EC] flex items-center justify-center font-black text-white text-sm shrink-0">
                      {c.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-white font-bold text-sm">@{c.userId}</span>
                      </div>
                      <p className="text-zinc-300 text-sm break-words">{c.text}</p>
                    </div>
                    {c.userId === currentUserId && (
                      <button onClick={() => handleDeleteComment(c.id)} className="text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 text-xs">삭제</button>
                    )}
                  </div>
                ))}
              </div>
              {currentUserId && (
                <div className="p-3 border-t border-zinc-800 flex gap-2">
                  <input
                    type="text" value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !postingComment) handlePostComment(); }}
                    placeholder="댓글 입력..."
                    disabled={postingComment}
                    className="flex-1 bg-zinc-900 text-white rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#7C5CFC] disabled:opacity-50"
                  />
                  <button
                    onClick={handlePostComment}
                    disabled={postingComment || !commentText.trim()}
                    className="bg-[#7C5CFC] text-white rounded-full p-2.5 disabled:opacity-50"
                  >
                    <Send size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalClips = clips.length;
  const totalSteps = totalClips + 1; 
  const isFinalStep = currentIndex === totalClips;
  const current = !isFinalStep ? clips[currentIndex] : null;

  const handleNext = () => {
    if (currentIndex < totalSteps - 1) {
      setCurrentIndex(prev => prev + 1);
      setIsPlaying(false);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setIsPlaying(false);
    }
  };

  const handlePlayVideo = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-between py-10 px-4">
      <div className="w-full flex justify-between items-center mb-6">
        <button onClick={onBack} className="text-white p-2">
          <ArrowLeft size={28} />
        </button>
        <div className="text-white font-bold tracking-widest text-lg flex items-center gap-2">
          <span className="text-green-400">STEP {currentIndex + 1}</span> 
          <span className="text-white/30">/ {totalSteps}</span>
        </div>
        <div className="w-10"></div>
      </div>

      <div className="w-full max-w-sm mb-6">
        <div className="flex justify-between items-center bg-zinc-900 rounded-2xl p-2">
          {SPEEDS.map((speed) => (
            <button
              key={speed.label}
              onClick={() => setPlaybackRate(speed.rate)}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                playbackRate === speed.rate 
                  ? 'bg-white text-black shadow-md' 
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {speed.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full max-w-sm aspect-[9/16] bg-black rounded-3xl overflow-hidden shadow-2xl flex-1 mb-8">
        {isFinalStep ? (
          <img 
            src={`${apiUrl}/thumb/${jobId}/0`} 
            alt="Final" 
            className="w-full h-full object-contain bg-black opacity-40 blur-sm" 
          />
        ) : (
          /* 💡 핵심 수정 포인트: object-cover -> object-contain bg-black */
          <video
            ref={videoRef}
            src={resolveUrl(apiUrl, current!.video_url)}
            className="w-full h-full object-contain bg-black"
            onEnded={() => setIsPlaying(false)}
            playsInline
          />
        )}

        {!isPlaying && !isFinalStep && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm cursor-pointer" onClick={handlePlayVideo}>
            <div className="bg-white/20 p-5 rounded-full backdrop-blur-md">
              <Play size={40} className="text-white fill-white ml-1" />
            </div>
          </div>
        )}
        
        {isFinalStep && !isPlaying && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center w-full">
             <Trophy className="w-16 h-16 text-green-400 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)]" />
             <p className="text-white font-black text-2xl tracking-widest drop-shadow-md">FINAL STAGE</p>
             <p className="text-white/60 mt-2 font-bold">배운 동작을 하나로 이어서 도전!</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 w-full max-w-sm shrink-0 mb-4">
        <button 
          onClick={handlePrev} 
          disabled={currentIndex === 0} 
          className="flex-1 py-4 bg-zinc-900 rounded-2xl font-black text-white disabled:opacity-30 disabled:bg-transparent flex items-center justify-center transition-all hover:bg-zinc-800"
        >
          <ChevronLeft className="mr-1" />이전
        </button>
        <button 
          onClick={handleNext} 
          disabled={isFinalStep} 
          className="flex-1 py-4 bg-zinc-900 rounded-2xl font-black text-white disabled:opacity-30 disabled:bg-transparent flex items-center justify-center transition-all hover:bg-zinc-800"
        >
          다음<ChevronRight className="ml-1" />
        </button>
      </div>

      <button 
        onClick={() => onStartChallenge(isFinalStep ? (fullVideoUrl ?? `/full-video/${jobId}`) : current!.video_url, playbackRate)}
        className={`w-full max-w-sm py-5 font-black text-lg rounded-2xl flex items-center justify-center gap-3 shrink-0 transition-all ${
          isFinalStep 
            ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black shadow-[0_0_30px_rgba(74,222,128,0.4)] hover:scale-[1.02]' 
            : 'bg-white text-black hover:bg-gray-200'
        }`}
      >
        <Play fill="black" size={24} />
        {isFinalStep ? '최종 챌린지 시작!' : '이 동작 챌린지 시작!'}
      </button>
    </div>
  );
}
