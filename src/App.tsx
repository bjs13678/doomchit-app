import { useState, useEffect, useRef } from 'react'; import { motion, 
AnimatePresence } from 'motion/react'; import { Trophy, User, Play, Plus,
Upload, Loader2, CheckCircle, Palette, UserCheck, Search, ChevronUp,
ChevronDown, Minus, LogIn, Settings, LogOut, X, Trash2, Heart, Camera } from 'lucide-react'; import { doc, getDoc, setDoc,
collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, limit, where, getDocs, deleteDoc }
from 'firebase/firestore'; import { onAuthStateChanged } from 
'firebase/auth'; import {
createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile,
GoogleAuthProvider, signInWithPopup
} from 'firebase/auth'; import {
ref as storageRef, uploadBytes, getDownloadURL
} from 'firebase/storage'; import { db, auth, storage } from './firebase'; import 
'./index.css'; import './i18n'; import Learn from './Learn'; import 
ChallengeComponent from './Challenge';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// 백엔드가 절대 URL(Firebase Storage) 또는 상대 경로(/clip/, /thumb/, /full-video/)를 줄 수 있어
// 절대 URL이면 그대로, 상대 경로면 API_URL 앞에 붙임
const resolveUrl = (url: string) => url.startsWith('http') ? url : `${API_URL}${url}`;

// --- [디자인 폰트 설정] ---
const LOGO_FONT = "font-['Black_Han_Sans']";
const MAIN_FONT = "font-['Noto_Sans_KR']";

const PRESET_COLORS = [
  { name: '초록', hex: '#00FF00' }, { name: '시안 (파랑)', hex: '#00FFFF' },
  { name: '노랑', hex: '#FFFF00' }, { name: '마젠타 (분홍)', hex: '#FF00FF' },
  { name: '흰색', hex: '#FFFFFF' },
];

interface UserProfile { id: string; displayName: string; photoURL?: string; level: number; exp: number; badges: string[]; }
interface Clip { index: number; start_frame: number; end_frame: number; duration: number; video_url: string; thumb_url: string; }
interface Track { id: string; title: string; artist: string; albumArt: string | null; previewUrl: string | null; }
interface ChallengeData { id: string; title: string; creatorName: string; creatorId: string; jobId: string; clips: Clip[]; difficulty: string; likeCount: number; participantCount: number; timestamp: any; music?: Track | null; fullVideoUrl?: string | null; }

// ── Spotify 음악 검색 컴포넌트 (업로드 + 피드 공용) ──────────────────────────────
const MusicSearch = ({ onSelect, selected, onClear }: {
  onSelect: (track: Track | null) => void;
  selected: Track | null;
  onClear: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=8&country=KR`;
        const res = await fetch(url);
        const data = await res.json();
        setResults((data.results || []).map((t: any) => ({
          id: String(t.trackId),
          title: t.trackName,
          artist: t.artistName,
          albumArt: t.artworkUrl100 ?? t.artworkUrl60 ?? null,
          previewUrl: t.previewUrl ?? null,
        })));
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 400);
  };

  if (selected) {
    return (
      <div className="flex items-center gap-3 bg-[#7C5CFC]/10 border border-[#7C5CFC]/30 rounded-2xl p-3">
        {selected.albumArt && <img src={selected.albumArt} className="w-12 h-12 rounded-xl flex-shrink-0 object-cover" alt="" />}
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm truncate">{selected.title}</p>
          <p className="text-xs text-gray-500 truncate">{selected.artist}</p>
        </div>
        <button onClick={onClear} className="text-gray-400 hover:text-gray-600 flex-shrink-0 p-1">
          <Minus size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text" value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); }}
          placeholder="제목·가사·아티스트 이름으로 검색"
          className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl pl-10 pr-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#7C5CFC]"
        />
        {loading && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#7C5CFC]" />}
      </div>
      {results.length > 0 && (
        <div className="bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-lg">
          {results.map(track => (
            <button key={track.id} onClick={() => { onSelect(track); setQuery(''); setResults([]); }}
              className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all text-left border-b border-gray-100 dark:border-gray-900 last:border-0">
              {track.albumArt
                ? <img src={track.albumArt} className="w-10 h-10 rounded-lg flex-shrink-0 object-cover" alt="" />
                : <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-gray-800 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{track.title}</p>
                <p className="text-xs text-gray-500 truncate">{track.artist}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
interface AnalysisState {
  jobId: string;
  status: 'analyzing' | 'done' | 'error';
  progress: number;
  message: string;
  title: string;
  userColor: string;
  music: Track | null;
}

// ── 분석 진행 화면 (앱 레벨에서 렌더, 탭 전환과 무관하게 폴링 유지) ──────────────────────
const AnalysisProgressView = ({ analysis, onDismiss }: { analysis: AnalysisState; onDismiss: () => void }) => {
  if (analysis.status === 'done') {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[80vh] space-y-6">
        <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', bounce: 0.5 }} className="text-[#7C5CFC]">
          <CheckCircle size={120} strokeWidth={1.5} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="text-center space-y-2">
          <h2 className="text-3xl font-black">분석 완료! 🎉</h2>
          <p className="text-gray-500 font-bold">"{analysis.title}"</p>
        </motion.div>
        <button onClick={onDismiss} className="w-full max-w-sm bg-[#7C5CFC] text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#684be0] active:scale-95">
          <Plus size={20} /> 새로 만들기
        </button>
      </div>
    );
  }

  if (analysis.status === 'error') {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[80vh] space-y-6">
        <div className="text-red-500 text-7xl">⚠️</div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black">분석 실패</h2>
          <p className="text-gray-500 font-bold text-sm break-all">{analysis.message}</p>
        </div>
        <button onClick={onDismiss} className="w-full max-w-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 py-4 rounded-2xl font-bold">
          닫기
        </button>
      </div>
    );
  }

  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (analysis.progress / 100) * circumference;

  return (
    <div className="p-6 pb-24 flex flex-col items-center justify-center min-h-[80vh] space-y-8">
      <div className="text-center space-y-2">
        <p className="text-xs font-bold text-[#7C5CFC] uppercase tracking-widest">분석 중</p>
        <h2 className="text-2xl font-black">{analysis.title}</h2>
      </div>

      <div className="relative w-64 h-64 flex items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-gray-200 dark:text-gray-800" />
          <motion.circle
            cx="100" cy="100" r={radius} fill="none" stroke="#7C5CFC" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </svg>
        <div className="text-center">
          <p className="text-6xl font-black text-[#7C5CFC]">{analysis.progress}<span className="text-2xl">%</span></p>
        </div>
      </div>

      <div className="bg-[#7C5CFC]/10 rounded-2xl px-5 py-4 max-w-sm w-full">
        <div className="flex items-center gap-3">
          <Loader2 className="animate-spin text-[#7C5CFC] flex-shrink-0" size={20} />
          <p className="font-bold text-[#7C5CFC] text-sm">{analysis.message || 'AI 분석 시작 중...'}</p>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center font-bold max-w-sm">
        다른 탭으로 이동해도 분석은 계속됩니다.<br />완료되면 이 화면으로 돌아오세요.
      </p>
    </div>
  );
};

// ── 업로드 화면 (인물 감지/선택까지만 담당, 분석은 App 레벨로 위임) ─────────────────────
const UploadView = ({ onStartAnalysis }: {
  onStartAnalysis: (data: { jobId: string; title: string; userColor: string; targetColor: string; selectedBox: number[] | null; music: Track | null }) => void
}) => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const [status, setStatus] = useState<'idle' | 'detecting' | 'selecting'>('idle');
  const [progressMsg, setProgressMsg] = useState('');

  const [userColor, setUserColor] = useState('#00FF00');
  const [targetColor, setTargetColor] = useState('#00FFFF');

  const [selectedMusic, setSelectedMusic] = useState<Track | null>(null);
  const [noMusic, setNoMusic] = useState(false);

  const [jobId, setJobId] = useState('');
  const [frameInfo, setFrameInfo] = useState({ url: '', w: 0, h: 0, boxes: [] as number[][] });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadAndDetect = async () => {
    if (!videoFile || !title.trim()) return alert("영상과 제목을 모두 입력해주세요!");
    setStatus('detecting');
    setProgressMsg('AI가 영상의 사람들을 찾고 있습니다...');

    const formData = new FormData();
    formData.append('file', videoFile);

    try {
      const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
      const data = await res.json();

      setJobId(data.job_id);
      setFrameInfo({ url: data.first_frame_url, w: data.img_width, h: data.img_height, boxes: data.boxes });
      setStatus('selecting');
    } catch (err) {
      setStatus('idle');
      alert('백엔드 서버에 연결할 수 없습니다. 파이썬 서버를 켜주세요!');
    }
  };

  const handleStartAnalysis = async (selectedBox: number[] | null) => {
    try {
      await fetch(`${API_URL}/start/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetColor, targetBox: selectedBox, hasMusic: !noMusic && !!selectedMusic })
      });
      onStartAnalysis({ jobId, title: title.trim(), userColor, targetColor, selectedBox, music: noMusic ? null : selectedMusic });
    } catch (err) {
      alert("분석 시작 실패!");
    }
  };

  if (status === 'selecting') {
    return (
      <div className="p-6 pb-24 space-y-6">
        <h2 className="text-2xl font-black uppercase italic flex items-center gap-2">
          <UserCheck className="text-[#7C5CFC]" /> 인물 선택
        </h2>
        <p className="text-gray-500 font-bold text-sm">
          영상에서 따라 하고 싶은 사람의 <span className="text-[#7C5CFC]">보라색 박스</span>를 터치하세요!
        </p>

        <div className="relative w-full rounded-2xl overflow-hidden bg-black shadow-lg border border-gray-200 dark:border-gray-800" style={{ aspectRatio: `${frameInfo.w} / ${frameInfo.h}` }}>
          <img src={resolveUrl(frameInfo.url)} alt="First Frame" className="absolute inset-0 w-full h-full object-cover" />
          {frameInfo.boxes.map((box, i) => {
            const [x1, y1, x2, y2] = box;
            const left = (x1 / frameInfo.w) * 100;
            const top = (y1 / frameInfo.h) * 100;
            const width = ((x2 - x1) / frameInfo.w) * 100;
            const height = ((y2 - y1) / frameInfo.h) * 100;
            
            return (
              <div 
                key={i} onClick={() => handleStartAnalysis(box)}
                className="absolute border-4 border-[#7C5CFC] bg-[#7C5CFC]/20 cursor-pointer hover:bg-[#7C5CFC]/50 hover:scale-105 transition-all shadow-[0_0_15px_rgba(124,92,252,0.5)]"
                style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
              />
            );
          })}
        </div>

        <button onClick={() => handleStartAnalysis(null)} className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-4 rounded-2xl font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition-all active:scale-95">
          전체 분석하기 (건너뛰기)
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 pb-24 space-y-6">
      <h2 className="text-2xl font-black uppercase italic">챌린지 만들기</h2>

      <div onClick={() => fileInputRef.current?.click()} className="relative aspect-[3/4] bg-gray-100 dark:bg-gray-900 rounded-3xl overflow-hidden flex items-center justify-center cursor-pointer border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-[#7C5CFC]">
        {videoPreview ? <video src={videoPreview} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-2 text-gray-400"><Upload size={40} /><p className="font-bold text-sm">영상을 클릭해서 업로드</p></div>}
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setVideoFile(f); setVideoPreview(URL.createObjectURL(f)); } }} />
      </div>

      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="멋진 챌린지 제목을 입력하세요" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl px-4 py-4 font-bold outline-none focus:ring-2 focus:ring-[#7C5CFC]" />

      {/* 음악 선택 */}
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-3xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎵</span>
            <h3 className="font-bold">어떤 음악인가요?</h3>
          </div>
          <button
            onClick={() => { setNoMusic(!noMusic); if (!noMusic) setSelectedMusic(null); }}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all ${noMusic ? 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-300' : 'bg-gray-200 dark:bg-gray-800 text-gray-500'}`}
          >
            {noMusic ? '✓ 음악 없음' : '음악 없음'}
          </button>
        </div>
        {!noMusic && (
          <MusicSearch
            selected={selectedMusic}
            onSelect={setSelectedMusic}
            onClear={() => setSelectedMusic(null)}
          />
        )}
        {!noMusic && !selectedMusic && (
          <p className="text-xs text-gray-400 font-bold">💡 제목이 기억 안 나도 가사 한 줄이나 아티스트 이름으로 검색해보세요</p>
        )}
      </div>

      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 rounded-3xl space-y-5">
        <div className="flex items-center gap-2 mb-2"><Palette className="text-[#7C5CFC]" size={20} /><h3 className="font-bold">스틱맨 색상 설정</h3></div>
        <div>
          <p className="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center"><span>원본 영상 스틱맨 (AI)</span></p>
          <div className="flex gap-2">{PRESET_COLORS.map(c => <button key={`target-${c.hex}`} onClick={() => setTargetColor(c.hex)} className={`flex-1 h-10 rounded-xl border-2 transition-all ${targetColor === c.hex ? 'border-gray-400 scale-110' : 'border-transparent shadow-sm'}`} style={{ backgroundColor: c.hex }} />)}</div>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center"><span>내 동작 스틱맨 (웹캠)</span></p>
          <div className="flex gap-2">{PRESET_COLORS.map(c => <button key={`user-${c.hex}`} onClick={() => setUserColor(c.hex)} className={`flex-1 h-10 rounded-xl border-2 transition-all ${userColor === c.hex ? 'border-gray-400 scale-110' : 'border-transparent shadow-sm'}`} style={{ backgroundColor: c.hex }} />)}</div>
        </div>
      </div>

      {status === 'detecting' && (
        <div className="bg-[#7C5CFC]/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-[#7C5CFC]" size={18} />
            <p className="font-bold text-[#7C5CFC] text-sm">{progressMsg}</p>
          </div>
        </div>
      )}

      <button onClick={handleUploadAndDetect} disabled={status !== 'idle' || !videoFile} className="w-full bg-[#7C5CFC] text-white py-5 rounded-2xl font-black flex justify-center items-center gap-2 disabled:opacity-50 hover:bg-[#684be0] active:scale-95 transition-all">
        {status === 'idle' ? <><Plus size={24} /> 인물 찾기 시작</> : <><Loader2 className="animate-spin" /> 처리 중...</>}
      </button>
    </div>
  );
};

// ── 피드 화면 (파이어베이스 기능 + 숏폼 UI + 노래 검색 필터 + 좋아요) ────────────────────
const FeedView = ({ onSelectChallenge, userProfile, followingIds, onToggleFollow }: {
  onSelectChallenge: (c: ChallengeData) => void;
  userProfile: UserProfile | null;
  followingIds: Set<string>;
  onToggleFollow: (targetId: string) => void;
}) => {
  const [challenges, setChallenges] = useState<ChallengeData[]>([]);
  const [filterTrack, setFilterTrack] = useState<Track | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const q = query(collection(db, 'challenges'), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, snap => setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChallengeData))));
  }, []);

  // 좋아요 데이터 구독 (자기 좋아요 + 전체 카운트)
  useEffect(() => {
    return onSnapshot(collection(db, 'likes'), snap => {
      const mine = new Set<string>();
      const counts = new Map<string, number>();
      snap.docs.forEach(d => {
        const data = d.data() as any;
        counts.set(data.challengeId, (counts.get(data.challengeId) || 0) + 1);
        if (userProfile && data.userId === userProfile.id) mine.add(data.challengeId);
      });
      setLikedIds(mine);
      setLikeCounts(counts);
    });
  }, [userProfile?.id]);

  const toggleLike = async (challengeId: string) => {
    if (!userProfile) return;
    const likeId = `${userProfile.id}_${challengeId}`;
    const ref = doc(db, 'likes', likeId);
    if (likedIds.has(challengeId)) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { userId: userProfile.id, challengeId, timestamp: serverTimestamp() });
    }
  };

  const displayed = filterTrack
    ? challenges.filter(c => c.music?.id === filterTrack.id)
    : challenges;

  return (
    <div className="p-4 pb-24 space-y-4">
      {/* 노래로 챌린지 검색 */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-400 px-1">🎵 노래로 찾기</p>
        <MusicSearch
          selected={filterTrack}
          onSelect={setFilterTrack}
          onClear={() => setFilterTrack(null)}
        />
      </div>

      <div className="flex justify-between items-center px-1 pt-2">
        <h2 className="text-xl font-black">
          {filterTrack ? `"${filterTrack.title}" 챌린지` : '추천 챌린지'}
        </h2>
        {filterTrack && (
          <button onClick={() => setFilterTrack(null)} className="text-xs font-bold text-[#7C5CFC]">전체 보기</button>
        )}
      </div>

      {displayed.length === 0 && (
        <div className="flex flex-col items-center justify-center mt-20 gap-4 text-gray-400">
          <Upload size={48} strokeWidth={1} />
          <p className="font-bold text-center">
            {filterTrack ? `"${filterTrack.title}" 챌린지가 아직 없어요!\n첫 챌린지를 만들어보세요 🕺` : '아직 챌린지가 없어요!\n첫 챌린지를 만들어보세요 🕺'}
          </p>
        </div>
      )}

      {displayed.map(c => {
        const liked = likedIds.has(c.id);
        const count = likeCounts.get(c.id) || 0;
        return (
        <div key={c.id} onClick={() => onSelectChallenge(c)} className="relative aspect-[3/4] bg-gray-200 dark:bg-gray-900 rounded-[2rem] overflow-hidden shadow-lg group cursor-pointer">
          {c.clips && c.clips[0] && <img src={resolveUrl(c.clips[0].thumb_url)} className="absolute inset-0 w-full h-full object-cover" alt={c.title} />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute bottom-6 left-6 right-20">
            <h3 className="text-white text-3xl font-black mb-1">{c.title}</h3>
            {c.music && (
              <div className="flex items-center gap-2 mb-1">
                {c.music.albumArt && <img src={c.music.albumArt} className="w-5 h-5 rounded" alt="" />}
                <p className="text-white/90 text-xs font-bold truncate">{c.music.title} — {c.music.artist}</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <p className="text-white/70 text-sm font-bold">@{c.creatorName}</p>
              {userProfile && c.creatorId !== userProfile.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFollow(c.creatorId); }}
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    followingIds.has(c.creatorId)
                      ? 'bg-white/20 text-white border border-white/40'
                      : 'bg-[#7C5CFC] text-white'
                  }`}
                >
                  {followingIds.has(c.creatorId) ? '팔로잉' : '+ 팔로우'}
                </button>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); toggleLike(c.id); }}
            className="absolute bottom-6 right-5 flex flex-col items-center gap-1 group/like"
          >
            <Heart size={32} className={`transition-all ${liked ? 'fill-red-500 text-red-500 scale-110' : 'text-white group-hover/like:scale-110'} drop-shadow-lg`} />
            <span className="text-white text-xs font-black drop-shadow-lg">{count}</span>
          </button>
          <button className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/20 backdrop-blur-md p-5 rounded-full opacity-0 group-hover:opacity-100 transition-all pointer-events-none">
            <Play fill="white" color="white" size={32} />
          </button>
        </div>
        );
      })}
    </div>
  );
};

// ── 랭킹 화면 (실시간 submissions 집계 + 전체/곡별 모드) ──────────────────────────
interface UserAgg {
  userId: string;
  displayName: string;
  total: number;
  max: number;
  count: number;
}
interface Submission {
  id: string;
  userId: string;
  displayName: string;
  challengeId: string;
  challengeTitle: string;
  musicId: string | null;
  musicTitle: string | null;
  musicArtist: string | null;
  musicAlbumArt: string | null;
  score: number;
  timestamp: any;
}

const PodiumCard = ({ rank, agg, isMe, mode }: { rank: number; agg: UserAgg; isMe: boolean; mode: 'overall' | 'song' }) => {
  const heights = { 1: 'h-32', 2: 'h-24', 3: 'h-20' } as const;
  const colors = { 1: 'from-yellow-400 to-yellow-300', 2: 'from-gray-300 to-gray-200', 3: 'from-orange-400 to-orange-300' } as const;
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: rank * 0.1 }}
      className="flex flex-col items-center gap-2 flex-1"
    >
      <div className="text-4xl">{medals[rank as 1|2|3]}</div>
      <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${colors[rank as 1|2|3]} flex items-center justify-center text-2xl font-black text-white shadow-lg ${isMe ? 'ring-4 ring-[#7C5CFC]' : ''}`}>
        {agg.displayName.charAt(0).toUpperCase()}
      </div>
      <p className={`font-black text-sm truncate max-w-[80px] ${isMe ? 'text-[#7C5CFC]' : ''}`}>{agg.displayName}</p>
      <div className={`w-full ${heights[rank as 1|2|3]} bg-gradient-to-t ${colors[rank as 1|2|3]} rounded-t-2xl flex items-start justify-center pt-3`}>
        <span className="text-2xl font-black text-white drop-shadow">{mode === 'overall' ? agg.total.toLocaleString() : agg.max}</span>
      </div>
    </motion.div>
  );
};

const RankingView = ({ userProfile }: { userProfile: UserProfile | null }) => {
  const [mode, setMode] = useState<'overall' | 'song'>('overall');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [filterTrack, setFilterTrack] = useState<Track | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'submissions'), orderBy('timestamp', 'desc'), limit(500));
    return onSnapshot(q, snap => setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Submission))));
  }, []);

  const aggregated: UserAgg[] = (() => {
    const filtered = mode === 'song' && filterTrack
      ? submissions.filter(s => s.musicId === filterTrack.id)
      : submissions;
    const byUser = new Map<string, UserAgg>();
    for (const s of filtered) {
      const cur = byUser.get(s.userId) || { userId: s.userId, displayName: s.displayName, total: 0, max: 0, count: 0 };
      cur.total += s.score;
      cur.max = Math.max(cur.max, s.score);
      cur.count += 1;
      cur.displayName = s.displayName; // 최신 displayName 유지
      byUser.set(s.userId, cur);
    }
    const sortKey = mode === 'overall' ? 'total' : 'max';
    return Array.from(byUser.values()).sort((a, b) => b[sortKey] - a[sortKey]);
  })();

  const top3 = aggregated.slice(0, 3);
  const rest = aggregated.slice(3, 50);
  const myRank = userProfile ? aggregated.findIndex(a => a.userId === userProfile.id) + 1 : 0;
  const myAgg = userProfile ? aggregated.find(a => a.userId === userProfile.id) : null;
  const showMyRow = myAgg && myRank > 3;

  return (
    <div className="p-4 pb-24 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-black flex items-center gap-2">
          <Trophy className="text-yellow-400" size={26} /> 랭킹
        </h2>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 p-1 rounded-full">
          <button onClick={() => setMode('overall')} className={`text-xs font-black px-4 py-2 rounded-full transition-all ${mode === 'overall' ? 'bg-[#7C5CFC] text-white' : 'text-gray-500'}`}>전체</button>
          <button onClick={() => setMode('song')} className={`text-xs font-black px-4 py-2 rounded-full transition-all ${mode === 'song' ? 'bg-[#7C5CFC] text-white' : 'text-gray-500'}`}>곡별</button>
        </div>
      </div>

      {mode === 'song' && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-400 px-1">🎵 곡 선택</p>
          <MusicSearch selected={filterTrack} onSelect={setFilterTrack} onClear={() => setFilterTrack(null)} />
        </div>
      )}

      {mode === 'song' && !filterTrack ? (
        <div className="flex flex-col items-center justify-center mt-20 gap-3 text-gray-400">
          <Search size={40} strokeWidth={1.5} />
          <p className="font-bold text-center">곡을 검색해서<br />그 곡의 랭킹을 확인하세요</p>
        </div>
      ) : aggregated.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 gap-3 text-gray-400">
          <Trophy size={48} strokeWidth={1} />
          <p className="font-bold text-center">아직 도전 기록이 없어요!<br />첫 번째 챌린지를 도전해보세요 🕺</p>
        </div>
      ) : (
        <>
          {/* Top 3 Podium */}
          {top3.length > 0 && (
            <div className="bg-gradient-to-b from-[#7C5CFC]/10 to-transparent rounded-3xl p-5 pt-6">
              <div className="flex items-end justify-around gap-2">
                {top3[1] && <PodiumCard rank={2} agg={top3[1]} isMe={top3[1].userId === userProfile?.id} mode={mode} />}
                {top3[0] && <PodiumCard rank={1} agg={top3[0]} isMe={top3[0].userId === userProfile?.id} mode={mode} />}
                {top3[2] && <PodiumCard rank={3} agg={top3[2]} isMe={top3[2].userId === userProfile?.id} mode={mode} />}
              </div>
            </div>
          )}

          {/* 4위~ 리스트 */}
          {rest.length > 0 && (
            <div className="space-y-2">
              {rest.map((agg, i) => {
                const rank = i + 4;
                const isMe = agg.userId === userProfile?.id;
                return (
                  <motion.div
                    key={agg.userId}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                    className={`flex items-center gap-4 p-3 rounded-2xl ${isMe ? 'bg-[#7C5CFC]/10 border-2 border-[#7C5CFC]' : 'bg-gray-50 dark:bg-gray-900'}`}
                  >
                    <div className="w-8 text-center">
                      <span className={`text-lg font-black ${isMe ? 'text-[#7C5CFC]' : 'text-gray-500'}`}>{rank}</span>
                    </div>
                    <div className={`w-10 h-10 rounded-full ${isMe ? 'bg-[#7C5CFC]' : 'bg-gradient-to-br from-gray-400 to-gray-300'} flex items-center justify-center font-black text-white`}>
                      {agg.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold truncate ${isMe ? 'text-[#7C5CFC]' : ''}`}>{agg.displayName} {isMe && <span className="text-xs">(나)</span>}</p>
                      <p className="text-xs text-gray-500">{mode === 'overall' ? `합계 ${agg.total.toLocaleString()}점 · ${agg.count}회` : `최고 ${agg.max}점`}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* 본인이 50위 밖이거나 4위 이하인데 안 보이면 별도 카드 */}
          {showMyRow && myAgg && myRank > 50 && (
            <div className="sticky bottom-20 mt-4">
              <div className="flex items-center gap-4 p-3 rounded-2xl bg-[#7C5CFC]/10 border-2 border-[#7C5CFC] shadow-lg">
                <div className="w-8 text-center"><span className="text-lg font-black text-[#7C5CFC]">{myRank}</span></div>
                <div className="w-10 h-10 rounded-full bg-[#7C5CFC] flex items-center justify-center font-black text-white">
                  {myAgg.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#7C5CFC]">나 ({myAgg.displayName})</p>
                  <p className="text-xs text-gray-500">{mode === 'overall' ? `합계 ${myAgg.total.toLocaleString()}점` : `최고 ${myAgg.max}점`}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── 메인 App ──────────────────────────────────────────
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('feed');

  const [selectedChallenge, setSelectedChallenge] = useState<ChallengeData | null>(null);
  const [isLearning, setIsLearning] = useState(false);
  const [challengeClipUrl, setChallengeClipUrl] = useState('');
  const [challengeSpeed, setChallengeSpeed] = useState(1.0);
  const [userColor, setUserColor] = useState('#00FF00');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loginHandle, setLoginHandle] = useState('');
  const [myChallenges, setMyChallenges] = useState<ChallengeData[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [seedBusy, setSeedBusy] = useState<'idle' | 'adding' | 'removing'>('idle');

  const SEED_USERS = [
    { id: 'seed_dancing_queen', displayName: '댄싱퀸' },
    { id: 'seed_doomchit_master', displayName: '둠칫마스터' },
    { id: 'seed_rhythm_lion', displayName: '리듬타는라이언' },
    { id: 'seed_challenge_king', displayName: '챌린지킹' },
    { id: 'seed_dance_god', displayName: '춤신춤왕' },
    { id: 'seed_kpop_lover', displayName: 'K팝러버' },
  ];
  const SEED_SONG_QUERIES = [
    'newjeans hype boy', 'aespa supernova', 'ive love dive',
    'lesserafim antifragile', 'newjeans super shy', 'illit magnetic',
  ];

  const handleSeedAdd = async () => {
    setSeedBusy('adding');
    try {
      // 1) iTunes에서 실곡 메타 조회
      const tracks: Track[] = [];
      for (const q of SEED_SONG_QUERIES) {
        try {
          const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1&country=KR`);
          const data = await res.json();
          const t = data.results?.[0];
          if (t) tracks.push({
            id: String(t.trackId),
            title: t.trackName,
            artist: t.artistName,
            albumArt: t.artworkUrl100 ?? null,
            previewUrl: t.previewUrl ?? null,
          });
        } catch {}
      }
      if (tracks.length === 0) { alert('iTunes 곡 조회 실패'); setSeedBusy('idle'); return; }

      // 2) 가짜 사용자별로 3~6회 submission 생성
      let count = 0;
      for (const user of SEED_USERS) {
        const numSubs = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < numSubs; i++) {
          const track = tracks[Math.floor(Math.random() * tracks.length)];
          const score = 50 + Math.floor(Math.random() * 50);
          await addDoc(collection(db, 'submissions'), {
            userId: user.id,
            displayName: user.displayName,
            challengeId: `seed_challenge_${track.id}`,
            challengeTitle: `${track.title} 챌린지`,
            musicId: track.id,
            musicTitle: track.title,
            musicArtist: track.artist,
            musicAlbumArt: track.albumArt,
            score,
            isSeed: true,
            timestamp: serverTimestamp(),
          });
          count++;
        }
      }
      alert(`✅ 테스트 데이터 ${count}개 추가 완료`);
    } catch (err) {
      alert('테스트 데이터 추가 실패: ' + err);
    } finally {
      setSeedBusy('idle');
    }
  };

  const handleSeedRemove = async () => {
    if (!confirm('테스트 데이터를 모두 삭제할까요?')) return;
    setSeedBusy('removing');
    try {
      const snap = await getDocs(query(collection(db, 'submissions'), where('isSeed', '==', true)));
      let count = 0;
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
        count++;
      }
      alert(`🗑️ 테스트 데이터 ${count}개 삭제 완료`);
    } catch (err) {
      alert('삭제 실패: ' + err);
    } finally {
      setSeedBusy('idle');
    }
  };

  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarUpload = async (file: File) => {
    if (!userProfile || !auth.currentUser) return;
    if (!file.type.startsWith('image/')) { alert('이미지 파일만 업로드 가능해요'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('5MB 이하 이미지만 가능해요'); return; }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const ref = storageRef(storage, `avatars/${auth.currentUser.uid}/profile.${ext}`);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      await setDoc(doc(db, 'users', userProfile.id), { photoURL: url }, { merge: true });
      setUserProfile({ ...userProfile, photoURL: url });
    } catch (err) {
      alert('사진 업로드 실패: ' + err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleDeleteChallenge = async (c: ChallengeData) => {
    if (!userProfile || c.creatorId !== userProfile.id) return;
    if (!confirm(`"${c.title}" 챌린지를 정말 삭제할까요?\n관련 도전 기록도 함께 삭제됩니다.`)) return;
    try {
      // 1) 이 챌린지의 모든 submissions 삭제
      const subsSnap = await getDocs(query(collection(db, 'submissions'), where('challengeId', '==', c.id)));
      await Promise.all(subsSnap.docs.map(d => deleteDoc(d.ref)));
      // 2) 챌린지 도큐 삭제
      await deleteDoc(doc(db, 'challenges', c.id));
      // (Storage 파일은 시간 지나면 자연 정리됨; 여기서 즉시 삭제하지 않음)
    } catch (err) {
      alert('삭제 실패: ' + err);
      console.warn('delete challenge failed', err);
    }
  };

  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠어요?')) return;
    try { await signOut(auth); } catch {}
    setMyChallenges([]);
    setShowSettings(false);
    setActiveTab('feed');
    setLoginHandle('');
    setLoginPassword('');
  };

  // Firebase Auth state → uid로 users 도큐 조회 → userProfile 세팅
  // Firestore에 도큐 없으면 needsUsername=true (Google 신규 가입자 등)
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserProfile(null);
        setIsLoggedIn(false);
        setNeedsUsername(false);
        return;
      }
      try {
        const q = query(collection(db, 'users'), where('uid', '==', user.uid), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data: any = d.data();
          setUserProfile({
            id: d.id,
            displayName: data.displayName || d.id,
            level: data.level ?? 1,
            exp: data.exp ?? 0,
            badges: data.badges ?? [],
          });
          setIsLoggedIn(true);
          setNeedsUsername(false);
        } else {
          // 인증 OK, Firestore 도큐 없음 → username 선택 필요 (Google 신규)
          const seed = (user.email?.split('@')[0] || user.displayName || '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 20);
          setUsernamePickerHandle(seed);
          setNeedsUsername(true);
          setIsLoggedIn(false);
        }
      } catch (err) {
        console.warn('failed to load profile', err);
      }
    });
  }, []);

  useEffect(() => {
    if (!userProfile || activeTab !== 'profile') return;
    const q = query(collection(db, 'challenges'), where('creatorId', '==', userProfile.id), orderBy('timestamp', 'desc'));
    return onSnapshot(q, snap => setMyChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChallengeData))));
  }, [userProfile, activeTab]);

  // 내가 팔로우하는 사람들
  useEffect(() => {
    if (!userProfile) { setFollowingIds(new Set()); setFollowingCount(0); return; }
    const q = query(collection(db, 'follows'), where('followerId', '==', userProfile.id));
    return onSnapshot(q, snap => {
      setFollowingIds(new Set(snap.docs.map(d => (d.data() as any).followingId)));
      setFollowingCount(snap.size);
    });
  }, [userProfile?.id]);

  // 나를 팔로우하는 사람들 카운트
  useEffect(() => {
    if (!userProfile) { setFollowerCount(0); return; }
    const q = query(collection(db, 'follows'), where('followingId', '==', userProfile.id));
    return onSnapshot(q, snap => setFollowerCount(snap.size));
  }, [userProfile?.id]);

  const toggleFollow = async (targetId: string) => {
    if (!userProfile || targetId === userProfile.id) return;
    const followId = `${userProfile.id}_${targetId}`;
    const ref = doc(db, 'follows', followId);
    if (followingIds.has(targetId)) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { followerId: userProfile.id, followingId: targetId, timestamp: serverTimestamp() });
    }
  };

  // 분석 폴링: App 레벨에서 동작 → 탭 전환과 무관하게 계속 진행
  useEffect(() => {
    if (!analysis || analysis.status !== 'analyzing') return;
    const jobId = analysis.jobId;
    let consecutive404 = 0;
    const MAX_404 = 5; // 약 7.5초 동안 404 → 서버 재시작 등으로 작업 유실 판정

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/status/${jobId}`);

        // 백엔드 재시작 등으로 job 유실 → 404 누적 시 사용자에게 알리고 종료
        if (res.status === 404) {
          consecutive404++;
          if (consecutive404 >= MAX_404) {
            clearInterval(poll);
            setAnalysis(prev => prev && prev.jobId === jobId ? {
              ...prev,
              status: 'error',
              message: '서버가 작업 정보를 잃었습니다. 새로고침 후 다시 시도해주세요.',
            } : prev);
          }
          return;
        }
        consecutive404 = 0; // 정상 응답 들어오면 카운터 리셋

        const result = await res.json();

        if (result.status === 'done') {
          clearInterval(poll);
          setAnalysis(prev => prev && prev.jobId === jobId ? { ...prev, status: 'done', progress: 100, message: '완료!' } : prev);
          setUserColor(analysis.userColor);
          try {
            await addDoc(collection(db, 'challenges'), {
              title: analysis.title,
              creatorName: userProfile?.displayName || '익명 댄서',
              creatorId: userProfile?.id || 'anonymous',
              jobId,
              clips: result.clips,
              difficulty: 'Medium',
              likeCount: 0,
              participantCount: 0,
              music: analysis.music ?? null,
              fullVideoUrl: result.full_video_url ?? null,
              timestamp: serverTimestamp(),
            });
          } catch (err) { console.warn('Firestore save failed:', err); }
        } else if (result.status === 'error') {
          clearInterval(poll);
          setAnalysis(prev => prev && prev.jobId === jobId ? { ...prev, status: 'error', message: result.message || '알 수 없는 오류' } : prev);
        } else {
          setAnalysis(prev => prev && prev.jobId === jobId ? { ...prev, progress: result.progress ?? prev.progress, message: result.message ?? prev.message } : prev);
        }
      } catch {
        // 일시적 네트워크 오류는 무시하고 다음 폴링에서 재시도 (404는 위에서 별도 처리)
      }
    }, 1500);
    return () => clearInterval(poll);
  }, [analysis?.jobId, analysis?.status]);

  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [needsUsername, setNeedsUsername] = useState(false);
  const [usernamePickerHandle, setUsernamePickerHandle] = useState('');
  const [usernamePickerError, setUsernamePickerError] = useState('');
  const [usernamePickerBusy, setUsernamePickerBusy] = useState(false);

  const FAKE_EMAIL_DOMAIN = '@doomchit.local';

  const handleGoogleLogin = async () => {
    setLoginBusy(true);
    setLoginError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // onAuthStateChanged 가 처리. 신규면 username 픽커 화면으로 진입
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // 사용자가 닫음 — 무시
      } else if (code === 'auth/popup-blocked') {
        setLoginError('팝업이 차단되었어요. 브라우저 설정을 확인해주세요');
      } else {
        setLoginError('Google 로그인 실패: ' + (err?.message || code));
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleUsernamePick = async () => {
    const handle = usernamePickerHandle.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-zA-Z0-9_]{2,20}$/.test(handle)) {
      setUsernamePickerError('2~20자 / 영문·숫자·_ 만 가능해요');
      return;
    }
    const user = auth.currentUser;
    if (!user) { setUsernamePickerError('인증이 만료되었어요. 다시 로그인해주세요'); return; }

    setUsernamePickerBusy(true);
    setUsernamePickerError('');
    try {
      const ref = doc(db, 'users', handle);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        setUsernamePickerError('이미 사용 중인 아이디예요');
        setUsernamePickerBusy(false);
        return;
      }
      await setDoc(ref, {
        uid: user.uid,
        displayName: handle,
        level: 1, exp: 0, badges: [],
        createdAt: serverTimestamp(),
      });
      try { await updateProfile(user, { displayName: handle }); } catch {}
      // 즉시 프로필 세팅 (onAuthStateChanged가 다시 안 도니까)
      setUserProfile({ id: handle, displayName: handle, level: 1, exp: 0, badges: [] });
      setIsLoggedIn(true);
      setNeedsUsername(false);
    } catch (err) {
      setUsernamePickerError('저장 실패: ' + err);
    } finally {
      setUsernamePickerBusy(false);
    }
  };

  const handleAuth = async () => {
    const handle = loginHandle.trim().replace(/^@/, '');
    const password = loginPassword;

    if (!handle) { setLoginError('아이디를 입력해주세요'); return; }
    if (!/^[a-zA-Z0-9_]{2,20}$/.test(handle)) {
      setLoginError('2~20자 / 영문·숫자·_ 만 가능해요');
      return;
    }
    if (!password || password.length < 6) {
      setLoginError('비밀번호는 6자 이상이어야 해요');
      return;
    }

    const email = `${handle.toLowerCase()}${FAKE_EMAIL_DOMAIN}`;
    setLoginBusy(true);
    setLoginError('');
    try {
      if (authMode === 'signup') {
        // 1) 아이디 중복 체크
        const existing = await getDoc(doc(db, 'users', handle));
        if (existing.exists()) {
          setLoginError('이미 사용 중인 아이디예요');
          setLoginBusy(false);
          return;
        }
        // 2) Firebase Auth 가입
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: handle });
        // 3) Firestore users 도큐 생성
        await setDoc(doc(db, 'users', handle), {
          uid: cred.user.uid,
          displayName: handle,
          level: 1, exp: 0, badges: [],
          createdAt: serverTimestamp(),
        });
        // onAuthStateChanged가 displayName으로 프로필 로드
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged 가 처리
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/email-already-in-use') setLoginError('이미 사용 중인 아이디예요');
      else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setLoginError('비밀번호가 틀렸어요');
      else if (code === 'auth/user-not-found') setLoginError('존재하지 않는 아이디예요');
      else if (code === 'auth/too-many-requests') setLoginError('잠시 후 다시 시도해주세요');
      else if (code === 'auth/network-request-failed') setLoginError('네트워크를 확인해주세요');
      else setLoginError('오류: ' + (err?.message || code || '알 수 없음'));
      console.warn('auth error', err);
    } finally {
      setLoginBusy(false);
    }
  };

  // Google 로그인 후 username 미설정 → 픽커 화면
  if (needsUsername) {
    return (
      <div className={`min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col items-center justify-center p-6 ${MAIN_FONT}`}>
        <h1 className={`${LOGO_FONT} text-5xl mb-2 text-[#7C5CFC] dark:text-[#D8D8EC]`}>둠칫</h1>
        <p className="text-gray-500 mb-2 font-bold tracking-widest">WELCOME</p>
        <h2 className="text-2xl font-black mb-2 mt-6">사용할 닉네임을 골라주세요</h2>
        <p className="text-sm text-gray-500 font-bold mb-8 text-center">다른 사용자에게 <span className="text-[#7C5CFC]">@닉네임</span> 으로 표시돼요.<br />한 번 정하면 나중에 못 바꿀 수도 있어요!</p>
        <div className="w-full max-w-sm space-y-3">
          <div className="relative">
            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 font-black text-xl pointer-events-none select-none">@</span>
            <input
              type="text"
              value={usernamePickerHandle}
              onChange={e => { setUsernamePickerHandle(e.target.value.replace(/^@/, '').toLowerCase()); if (usernamePickerError) setUsernamePickerError(''); }}
              onKeyDown={e => { if (e.key === 'Enter' && !usernamePickerBusy) handleUsernamePick(); }}
              placeholder="닉네임"
              disabled={usernamePickerBusy}
              className={`w-full p-4 pl-12 rounded-2xl bg-gray-100 dark:bg-gray-900 border-2 outline-none focus:ring-2 transition-all ${usernamePickerError ? 'border-red-500 focus:ring-red-500/30' : 'border-transparent focus:ring-[#7C5CFC]'} disabled:opacity-50`}
              autoFocus
            />
          </div>
          {usernamePickerError && <p className="text-xs font-bold text-red-500 px-2">{usernamePickerError}</p>}
          <button
            onClick={handleUsernamePick}
            disabled={usernamePickerBusy || !usernamePickerHandle.trim()}
            className="w-full bg-[#7C5CFC] text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
          >
            {usernamePickerBusy ? <><Loader2 size={20} className="animate-spin" /> 확인 중...</> : <><CheckCircle size={20} /> 둠칫 시작하기</>}
          </button>
          <button
            onClick={async () => { await signOut(auth); }}
            className="w-full text-sm text-gray-400 hover:text-gray-600 font-bold pt-3"
          >
            취소하고 다른 계정으로 로그인
          </button>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className={`min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col items-center justify-center p-6 ${MAIN_FONT}`}>
        <h1 className={`${LOGO_FONT} text-6xl mb-2 text-[#7C5CFC] dark:text-[#D8D8EC]`}>둠칫</h1>
        <p className="text-gray-500 mb-12 font-bold tracking-widest">DOOMCHIT</p>
        <div className="w-full max-w-sm space-y-3">
          {/* 아이디 */}
          <input
            type="text"
            value={loginHandle}
            onChange={e => { setLoginHandle(e.target.value.replace(/^@/, '').toLowerCase()); if (loginError) setLoginError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && !loginBusy) handleAuth(); }}
            placeholder="아이디"
            disabled={loginBusy}
            className={`w-full p-4 rounded-2xl bg-gray-100 dark:bg-gray-900 border-2 outline-none focus:ring-2 transition-all ${loginError ? 'border-red-500 focus:ring-red-500/30' : 'border-transparent focus:ring-[#7C5CFC]'} disabled:opacity-50`}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
          />

          {/* 비밀번호 */}
          <input
            type="password"
            value={loginPassword}
            onChange={e => { setLoginPassword(e.target.value); if (loginError) setLoginError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && !loginBusy) handleAuth(); }}
            placeholder="비밀번호 (6자 이상)"
            disabled={loginBusy}
            className={`w-full p-4 rounded-2xl bg-gray-100 dark:bg-gray-900 border-2 outline-none focus:ring-2 transition-all ${loginError ? 'border-red-500 focus:ring-red-500/30' : 'border-transparent focus:ring-[#7C5CFC]'} disabled:opacity-50`}
            autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
          />

          {loginError && (
            <p className="text-xs font-bold text-red-500 px-2">{loginError}</p>
          )}

          <button
            onClick={handleAuth}
            disabled={loginBusy || !loginHandle.trim() || !loginPassword}
            className="w-full bg-[#7C5CFC] text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
          >
            {loginBusy
              ? <><Loader2 size={20} className="animate-spin" /> 처리 중...</>
              : authMode === 'signup'
                ? <><Plus size={20} /> 회원가입</>
                : <><LogIn size={20} /> 로그인</>}
          </button>

          {/* 구분선 */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            <span className="text-xs text-gray-400 font-bold">또는</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          </div>

          {/* Google 로그인 */}
          <button
            onClick={handleGoogleLogin}
            disabled={loginBusy}
            className="w-full bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 p-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Google로 계속하기
          </button>

          {/* 모드 토글 */}
          <div className="text-center pt-2">
            <button
              onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setLoginError(''); }}
              className="text-sm text-gray-500 hover:text-[#7C5CFC] font-bold transition-all"
            >
              {authMode === 'login' ? '계정이 없으신가요? 회원가입 →' : '이미 계정이 있으신가요? 로그인 →'}
            </button>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-2 font-bold">아이디: 2~20자 / 영문·숫자·_</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white dark:bg-black text-black dark:text-white ${MAIN_FONT}`}>
      <header className="fixed top-0 left-0 w-full h-16 px-6 flex items-center bg-white/80 dark:bg-black/80 backdrop-blur-md z-[100] border-b border-gray-100 dark:border-gray-900">
        <h1 className={`${LOGO_FONT} text-3xl text-[#7C5CFC] dark:text-[#D8D8EC]`}>둠칫</h1>
      </header>

      <main className="pt-16 pb-24 max-w-md mx-auto min-h-screen relative shadow-2xl bg-white dark:bg-black">
        {!isLearning && !challengeClipUrl && (
          <div className="pt-4 animate-fade-in">
            {activeTab === 'feed' && <FeedView userProfile={userProfile} followingIds={followingIds} onToggleFollow={toggleFollow} onSelectChallenge={c => { setSelectedChallenge(c); setIsLearning(true); }} />}
            {activeTab === 'upload' && (
              analysis
                ? <AnalysisProgressView analysis={analysis} onDismiss={() => setAnalysis(null)} />
                : <UploadView onStartAnalysis={(data) => setAnalysis({
                    jobId: data.jobId,
                    status: 'analyzing',
                    progress: 0,
                    message: '선택된 인물의 동작을 집중 분석 중...',
                    title: data.title,
                    userColor: data.userColor,
                    music: data.music,
                  })} />
            )}
            
            {activeTab === 'ranking' && <RankingView userProfile={userProfile} />}

            {activeTab === 'profile' && userProfile && (
              <div className="p-4 pb-24">
                <div className="flex items-center justify-between mb-6 mt-2">
                  <div className="flex items-center gap-6">
                    <label className="relative w-24 h-24 rounded-full bg-gradient-to-tr from-[#7C5CFC] to-[#D8D8EC] p-1 cursor-pointer group block">
                      <div className="w-full h-full rounded-full border-4 border-white dark:border-black bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                        {userProfile.photoURL ? (
                          <img src={userProfile.photoURL} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User size={36} className="text-gray-400" />
                        )}
                      </div>
                      <div className="absolute inset-1 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                        {uploadingAvatar ? <Loader2 className="animate-spin text-white" size={20} /> : <Camera className="text-white" size={20} />}
                      </div>
                      <input
                        type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }}
                      />
                    </label>
                    <div>
                      <h2 className="text-2xl font-black mb-1">{userProfile.displayName}</h2>
                      <p className="text-[#7C5CFC] font-bold text-sm">@{userProfile.id}</p>
                      <div className="flex gap-4 mt-3 text-xs font-bold text-gray-500">
                        <span>게시물 {myChallenges.length}</span>
                        <span>팔로워 {followerCount}</span>
                        <span>팔로잉 {followingCount}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowSettings(true)}
                    aria-label="설정"
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all"
                  >
                    <Settings size={22} />
                  </button>
                </div>
                {myChallenges.length === 0 ? (
                  <div className="flex flex-col items-center justify-center mt-12 gap-4 text-gray-400">
                    <Upload size={48} strokeWidth={1} />
                    <p className="font-bold text-center">아직 올린 챌린지가 없어요!<br />첫 챌린지를 만들어보세요 🕺</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1">
                    {myChallenges.map(c => (
                      <div
                        key={c.id}
                        onClick={() => { setSelectedChallenge(c); setIsLearning(true); }}
                        className="aspect-square bg-gray-100 dark:bg-gray-900 relative group cursor-pointer overflow-hidden"
                      >
                        {c.clips?.[0] && (
                          <img src={resolveUrl(c.clips[0].thumb_url)} className="absolute inset-0 w-full h-full object-cover" alt={c.title} />
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all" />
                        <Play size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 group-hover:opacity-100" />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteChallenge(c); }}
                          className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                          aria-label="삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isLearning && !challengeClipUrl && (
          <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/90 dark:bg-black/90 backdrop-blur-xl border-t border-gray-100 dark:border-gray-900 px-4 py-3 flex justify-around z-[100] pb-safe">
            {[{ id: 'feed', icon: Play, label: '피드' }, { id: 'upload', icon: Plus, label: '올리기' }, { id: 'ranking', icon: Trophy, label: '랭킹' }, { id: 'profile', icon: User, label: '내 정보' }].map(tab => {
              const isUploadTab = tab.id === 'upload';
              const isAnalyzing = isUploadTab && analysis?.status === 'analyzing';
              const isDone = isUploadTab && analysis?.status === 'done';
              const isError = isUploadTab && analysis?.status === 'error';
              const isActive = activeTab === tab.id;

              const iconColor = isDone ? 'text-green-500' : isError ? 'text-red-500' : isAnalyzing ? 'text-[#7C5CFC]' : isActive ? 'text-[#7C5CFC] dark:text-[#D8D8EC]' : 'text-gray-400 hover:text-gray-300';
              const labelText = isAnalyzing ? `분석 ${analysis?.progress ?? 0}%` : isDone ? '완료!' : isError ? '오류' : tab.label;
              const shouldScale = isActive && !isAnalyzing && !isDone && !isError;

              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-1 transition-all ${iconColor} ${shouldScale ? 'scale-110' : ''}`}>
                  {isAnalyzing ? (
                    <Loader2 size={22} className="animate-spin" />
                  ) : isDone ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.6 }}>
                      <CheckCircle size={22} strokeWidth={2.5} />
                    </motion.div>
                  ) : (
                    <tab.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                  )}
                  <span className="text-[10px] font-black">{labelText}</span>
                </button>
              );
            })}
          </nav>
        )}

        {isLearning && selectedChallenge && (
          <div className="fixed inset-0 z-[200] bg-black">
            <Learn clips={selectedChallenge.clips} jobId={selectedChallenge.jobId} apiUrl={API_URL} fullVideoUrl={selectedChallenge.fullVideoUrl ?? undefined} challengeId={selectedChallenge.id} currentUserId={userProfile?.id} currentDisplayName={userProfile?.displayName} onStartChallenge={(url, speed) => { setChallengeClipUrl(url); setChallengeSpeed(speed); setIsLearning(false); }} onBack={() => { setIsLearning(false); setSelectedChallenge(null); }} />
          </div>
        )}

        {challengeClipUrl && (
          <div className="fixed inset-0 z-[200] bg-black">
            <ChallengeComponent
              videoUrl={resolveUrl(challengeClipUrl)}
              playbackRate={challengeSpeed}
              userStickmanColor={userColor}
              challengeTitle={selectedChallenge?.title}
              challengeArtist={selectedChallenge?.music?.artist}
              challengeId={selectedChallenge?.id}
              challengeMusicId={selectedChallenge?.music?.id}
              currentUserId={userProfile?.id}
              onBack={() => { setChallengeClipUrl(''); setIsLearning(true); }}
              onComplete={async (score) => {
                if (!userProfile || !selectedChallenge) return;
                try {
                  await addDoc(collection(db, 'submissions'), {
                    userId: userProfile.id,
                    displayName: userProfile.displayName,
                    challengeId: selectedChallenge.id,
                    challengeTitle: selectedChallenge.title,
                    musicId: selectedChallenge.music?.id ?? null,
                    musicTitle: selectedChallenge.music?.title ?? null,
                    musicArtist: selectedChallenge.music?.artist ?? null,
                    musicAlbumArt: selectedChallenge.music?.albumArt ?? null,
                    score,
                    timestamp: serverTimestamp(),
                  });
                } catch (err) { console.warn('submission save failed', err); }
              }}
            />
          </div>
        )}

        {/* 설정 바텀 시트 */}
        <AnimatePresence>
          {showSettings && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowSettings(false)}
                className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm"
              />
              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-[301] bg-white dark:bg-gray-950 rounded-t-3xl shadow-2xl pb-safe"
              >
                <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-900">
                  <h3 className="text-lg font-black flex items-center gap-2">
                    <Settings size={20} /> 설정
                  </h3>
                  <button onClick={() => setShowSettings(false)} className="p-1 text-gray-400 hover:text-gray-600">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-3">
                  <div className="px-5 py-3">
                    <p className="text-xs font-bold text-gray-400 mb-1">로그인 계정</p>
                    <p className="font-bold">@{userProfile?.id}</p>
                  </div>
                  {/* MVP 데모용 시드 데이터 */}
                  <div className="px-5 pt-2 pb-1">
                    <p className="text-xs font-bold text-gray-400">데모 / 개발</p>
                  </div>
                  <button
                    onClick={handleSeedAdd}
                    disabled={seedBusy !== 'idle'}
                    className="w-full flex items-center gap-3 px-5 py-3 rounded-2xl text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all font-bold disabled:opacity-50"
                  >
                    {seedBusy === 'adding' ? <Loader2 size={20} className="animate-spin" /> : <span className="text-xl">🎲</span>}
                    {seedBusy === 'adding' ? '추가 중...' : '테스트 데이터 추가'}
                  </button>
                  <button
                    onClick={handleSeedRemove}
                    disabled={seedBusy !== 'idle'}
                    className="w-full flex items-center gap-3 px-5 py-3 rounded-2xl text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900 transition-all font-bold disabled:opacity-50"
                  >
                    {seedBusy === 'removing' ? <Loader2 size={20} className="animate-spin" /> : <span className="text-xl">🗑️</span>}
                    {seedBusy === 'removing' ? '삭제 중...' : '테스트 데이터 삭제'}
                  </button>

                  <div className="px-5 pt-3 pb-1 mt-2 border-t border-gray-100 dark:border-gray-900">
                    <p className="text-xs font-bold text-gray-400">계정</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all font-bold"
                  >
                    <LogOut size={20} />
                    로그아웃
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
