import { useState, useEffect, useRef } from 'react'; import { motion, 
AnimatePresence } from 'motion/react'; import { Trophy, User, Play, Plus, 
Upload, Loader2, CheckCircle, Palette, UserCheck, Search, ChevronUp, 
ChevronDown, Minus, LogIn } from 'lucide-react'; import { doc, getDoc,
collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, limit, where }
from 'firebase/firestore'; import { onAuthStateChanged } from 
'firebase/auth'; import { db, auth } from './firebase'; import 
'./index.css'; import './i18n'; import Learn from './Learn'; import 
ChallengeComponent from './Challenge';

const API_URL = 'http://localhost:8000';

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
interface ChallengeData { id: string; title: string; creatorName: string; creatorId: string; jobId: string; clips: Clip[]; difficulty: string; likeCount: number; participantCount: number; timestamp: any; }
interface AnalysisState {
  jobId: string;
  status: 'analyzing' | 'done' | 'error';
  progress: number;
  message: string;
  title: string;
  userColor: string;
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
  onStartAnalysis: (data: { jobId: string; title: string; userColor: string; targetColor: string; selectedBox: number[] | null }) => void
}) => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const [status, setStatus] = useState<'idle' | 'detecting' | 'selecting'>('idle');
  const [progressMsg, setProgressMsg] = useState('');

  const [userColor, setUserColor] = useState('#00FF00');
  const [targetColor, setTargetColor] = useState('#00FFFF');

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
        body: JSON.stringify({ targetColor, targetBox: selectedBox })
      });
      onStartAnalysis({ jobId, title: title.trim(), userColor, targetColor, selectedBox });
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
          <img src={`${API_URL}${frameInfo.url}`} alt="First Frame" className="absolute inset-0 w-full h-full object-cover" />
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

// ── 피드 화면 (파이어베이스 기능 + 숏폼 UI) ──────────────────────────────────────────
const FeedView = ({ onSelectChallenge }: { onSelectChallenge: (c: ChallengeData) => void }) => {
  const [challenges, setChallenges] = useState<ChallengeData[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'challenges'), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, snap => setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChallengeData))));
  }, []);

  return (
    <div className="p-4 pb-24 space-y-6">
      <div className="flex justify-between items-center px-2">
        <h2 className="text-2xl font-black">추천 챌린지</h2>
        <div className="flex gap-3 text-sm font-bold text-gray-400">
          <button className="text-[#7C5CFC]">최신순</button>
          <button>인기순</button>
        </div>
      </div>

      {challenges.length === 0 && (
        <div className="flex flex-col items-center justify-center mt-20 gap-4 text-gray-400">
          <Upload size={48} strokeWidth={1} />
          <p className="font-bold text-center">아직 챌린지가 없어요!<br />첫 챌린지를 만들어보세요 🕺</p>
        </div>
      )}

      {challenges.map(c => (
        <div key={c.id} onClick={() => onSelectChallenge(c)} className="relative aspect-[3/4] bg-gray-200 dark:bg-gray-900 rounded-[2rem] overflow-hidden shadow-lg group cursor-pointer">
          {c.clips && c.clips[0] && <img src={`${API_URL}${c.clips[0].thumb_url}`} className="absolute inset-0 w-full h-full object-cover" alt={c.title} />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute bottom-6 left-6 right-6">
            <h3 className="text-white text-3xl font-black mb-1">{c.title}</h3>
            <p className="text-white/70 text-sm font-bold">@{c.creatorName}</p>
          </div>
          <button className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/20 backdrop-blur-md p-5 rounded-full opacity-0 group-hover:opacity-100 transition-all">
            <Play fill="white" color="white" size={32} />
          </button>
        </div>
      ))}
    </div>
  );
};

// ── 메인 App ──────────────────────────────────────────
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('feed');
  const [rankingMode, setRankingMode] = useState<'overall' | 'song'>('overall');

  const [selectedChallenge, setSelectedChallenge] = useState<ChallengeData | null>(null);
  const [isLearning, setIsLearning] = useState(false);
  const [challengeClipUrl, setChallengeClipUrl] = useState('');
  const [challengeSpeed, setChallengeSpeed] = useState(1.0);
  const [userColor, setUserColor] = useState('#00FF00');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loginHandle, setLoginHandle] = useState('');
  const [myChallenges, setMyChallenges] = useState<ChallengeData[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);

  // 더미 데이터 (추후 파이어베이스로 교체)
  const DUMMY_OVERALL = [
    { id: 1, rank: 1, diff: 0, name: "댄싱퀸", total: 45200, max: 99, img: "https://i.pravatar.cc/100?u=1" },
    { id: 2, rank: 2, diff: 1, name: "둠칫마스터", total: 42100, max: 98, img: "https://i.pravatar.cc/100?u=2" },
    { id: 3, rank: 3, diff: -1, name: "루키댄서", total: 38000, max: 95, img: "https://i.pravatar.cc/100?u=3" },
  ];

  useEffect(() => {
    const saved = localStorage.getItem('doomchit_user');
    if (saved) {
      try {
        setUserProfile(JSON.parse(saved));
        setIsLoggedIn(true);
      } catch {}
    }
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        setUserProfile(snap.exists()
          ? { id: user.uid, ...snap.data() } as UserProfile
          : { id: user.uid, displayName: user.displayName || 'User', level: 1, exp: 0, badges: [] }
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!userProfile || activeTab !== 'profile') return;
    const q = query(collection(db, 'challenges'), where('creatorId', '==', userProfile.id), orderBy('timestamp', 'desc'));
    return onSnapshot(q, snap => setMyChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChallengeData))));
  }, [userProfile, activeTab]);

  // 분석 폴링: App 레벨에서 동작 → 탭 전환과 무관하게 계속 진행
  useEffect(() => {
    if (!analysis || analysis.status !== 'analyzing') return;
    const jobId = analysis.jobId;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/status/${jobId}`);
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
        // 일시적 네트워크 오류는 무시하고 다음 폴링에서 재시도
      }
    }, 1500);
    return () => clearInterval(poll);
  }, [analysis?.jobId, analysis?.status]);

  const handleLogin = () => {
    const handle = loginHandle.trim().replace(/^@/, '');
    if (!handle) return alert('아이디를 입력해주세요');
    const profile: UserProfile = { id: handle, displayName: handle, level: 1, exp: 0, badges: [] };
    localStorage.setItem('doomchit_user', JSON.stringify(profile));
    setUserProfile(profile);
    setIsLoggedIn(true);
  };

  if (!isLoggedIn) {
    return (
      <div className={`min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col items-center justify-center p-6 ${MAIN_FONT}`}>
        <h1 className={`${LOGO_FONT} text-6xl mb-2 text-[#7C5CFC] dark:text-[#D8D8EC]`}>둠칫</h1>
        <p className="text-gray-500 mb-12 font-bold tracking-widest">DOOMCHIT</p>
        <div className="w-full max-w-sm space-y-4">
          <input
            type="text"
            value={loginHandle}
            onChange={e => setLoginHandle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
            placeholder="@아이디를 입력하세요"
            className="w-full p-4 rounded-2xl bg-gray-100 dark:bg-gray-900 border-none outline-none focus:ring-2 focus:ring-[#7C5CFC]"
          />
          <button onClick={handleLogin} className="w-full bg-[#7C5CFC] text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all">
            <LogIn size={20} /> 시작하기
          </button>
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
            {activeTab === 'feed' && <FeedView onSelectChallenge={c => { setSelectedChallenge(c); setIsLearning(true); }} />}
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
                  })} />
            )}
            
            {activeTab === 'ranking' && (
              <div className="p-4 pb-24 space-y-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-black">랭킹</h2>
                  <button onClick={() => setRankingMode(rankingMode === 'overall' ? 'song' : 'overall')} className="text-xs font-bold bg-[#7C5CFC]/10 text-[#7C5CFC] px-3 py-1.5 rounded-full">
                    {rankingMode === 'overall' ? '개별곡 랭킹 보기' : '전체 랭킹 보기'}
                  </button>
                </div>
                {rankingMode === 'overall' ? (
                  <div className="space-y-3">
                    {DUMMY_OVERALL.map((user) => (
                      <div key={user.id} className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-[1.5rem]">
                        <div className="flex flex-col items-center w-8">
                          <span className="text-xl font-black">{user.rank}</span>
                          <span className="text-[10px] font-bold">{user.diff > 0 ? <span className="text-red-500">▲{user.diff}</span> : user.diff < 0 ? <span className="text-blue-500">▼{Math.abs(user.diff)}</span> : <span className="text-gray-400">-</span>}</span>
                        </div>
                        <img src={user.img} className="w-12 h-12 rounded-full border-2 border-transparent hover:border-[#7C5CFC] cursor-pointer" onClick={() => setActiveTab('profile')} />
                        <div className="flex-1">
                          <p className="font-bold text-lg">{user.name}</p>
                          <p className="text-xs text-gray-500">합계 {user.total.toLocaleString()} | 최고 {user.max}점</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="relative"><Search className="absolute left-4 top-4 text-gray-400" size={18} /><input type="text" placeholder="챌린지 검색" className="w-full p-4 pl-12 rounded-2xl bg-gray-100 dark:bg-gray-900 outline-none focus:ring-2 focus:ring-[#7C5CFC]" /></div>
                    <div className="p-4 border-l-4 border-[#7C5CFC] bg-gray-50 dark:bg-gray-900 rounded-r-2xl mb-4"><p className="text-xs text-[#7C5CFC] font-bold">인기 곡</p><p className="font-black text-lg">Hype Boy - NewJeans</p></div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'profile' && userProfile && (
              <div className="p-4 pb-24">
                <div className="flex items-center gap-6 mb-8 mt-4">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-[#7C5CFC] to-[#D8D8EC] p-1">
                    <div className="w-full h-full rounded-full border-4 border-white dark:border-black bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                      <User size={36} className="text-gray-400" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-black mb-1">{userProfile.displayName}</h2>
                    <p className="text-[#7C5CFC] font-bold text-sm">@{userProfile.id}</p>
                    <div className="flex gap-4 mt-3 text-xs font-bold text-gray-500">
                      <span>게시물 {myChallenges.length}</span>
                      <span>레벨 {userProfile.level}</span>
                    </div>
                  </div>
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
                          <img src={`${API_URL}${c.clips[0].thumb_url}`} className="absolute inset-0 w-full h-full object-cover" alt={c.title} />
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all" />
                        <Play size={20} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 group-hover:opacity-100" />
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
            <Learn clips={selectedChallenge.clips} jobId={selectedChallenge.jobId} apiUrl={API_URL} onStartChallenge={(url, speed) => { setChallengeClipUrl(url); setChallengeSpeed(speed); setIsLearning(false); }} onBack={() => { setIsLearning(false); setSelectedChallenge(null); }} />
          </div>
        )}

        {challengeClipUrl && (
          <div className="fixed inset-0 z-[200] bg-black">
            <ChallengeComponent videoUrl={`${API_URL}${challengeClipUrl}`} playbackRate={challengeSpeed} userStickmanColor={userColor} onBack={() => { setChallengeClipUrl(''); setIsLearning(true); }} />
          </div>
        )}
      </main>
    </div>
  );
}
