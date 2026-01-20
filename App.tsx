
import React, { useState, useRef, useEffect } from 'react';
import { Subject, OutputLanguage, AppState } from './types';
import { extractOCRAndSubject, generateMasterNote, generateSummary, generateMCQBatch, generateFlashcards, clarifyText, generateMoreBonus } from './services/geminiService';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

interface ExtendedAppState extends AppState {
  error: string | null;
}

const App: React.FC = () => {
  const [state, setState] = useState<ExtendedAppState>({
    images: [],
    processing: false,
    ocrResult: null,
    masterNote: null,
    summary: null,
    mcqBatches: [],
    flashcards: [],
    language: OutputLanguage.BN,
    activeTab: 'master',
    currentQuestionIndex: 0,
    userAnswers: {},
    examFinished: false,
    error: null
  });

  const [loadingStates, setLoadingStates] = useState({
    ocr: false,
    notes: false,
    summary: false,
    practice: false,
    flashcards: false,
    clarification: false,
    moreBonus: false,
    morePractice: false
  });

  const [selection, setSelection] = useState<{ text: string, x: number, y: number, fullSentence: string } | null>(null);
  const [clarification, setClarification] = useState<{ definition: string, fullExplanation: string } | null>(null);

  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      const selectedText = window.getSelection()?.toString().trim();
      if (selectedText && selectedText.length > 1) {
        const selectionObj = window.getSelection();
        if (selectionObj && selectionObj.anchorNode) {
          const parentText = selectionObj.anchorNode.parentElement?.innerText || '';
          setSelection({
            text: selectedText,
            x: e.clientX,
            y: e.clientY,
            fullSentence: parentText
          });
        }
      } else {
        if (!clarification) setSelection(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [clarification]);

  const handleClarify = async () => {
    if (!selection) return;
    setLoadingStates(ls => ({ ...ls, clarification: true }));
    try {
      const result = await clarifyText(selection.text, selection.fullSentence, state.language);
      setClarification(result);
    } catch (err) {
      console.error(err);
      alert("Clarification failed. Please try again.");
    } finally {
      setLoadingStates(ls => ({ ...ls, clarification: false }));
    }
  };

  const handleMoreBonus = async () => {
    if (!state.ocrResult || !state.masterNote) return;
    setLoadingStates(ls => ({ ...ls, moreBonus: true }));
    try {
      const moreContent = await generateMoreBonus(state.ocrResult.ocrText, state.masterNote.layer3, state.ocrResult.subject, state.language);
      setState(prev => {
        if (!prev.masterNote) return prev;
        return {
          ...prev,
          masterNote: {
            ...prev.masterNote,
            layer3: prev.masterNote.layer3 + "\n\n" + moreContent
          }
        };
      });
    } catch (err) {
      console.error(err);
      alert("Failed to generate more bonus content.");
    } finally {
      setLoadingStates(ls => ({ ...ls, moreBonus: false }));
    }
  };

  const handleGenerateMoreMCQs = async () => {
    if (!state.ocrResult) return;
    setLoadingStates(ls => ({ ...ls, morePractice: true }));
    try {
      const nextBatchNum = state.mcqBatches.length + 1;
      const prevContext = state.mcqBatches.flatMap(b => b.questions.map(q => q.question)).join(" | ");
      const result = await generateMCQBatch(state.ocrResult.ocrText, state.language, nextBatchNum, prevContext);
      
      if (result.questions.length > 0) {
        const newBatch = {
          batchNumber: nextBatchNum,
          questions: result.questions,
          coverageReport: result.coverageReport
        };
        setState(prev => ({
          ...prev,
          mcqBatches: [...prev.mcqBatches, newBatch],
          currentQuestionIndex: 0,
          examFinished: false,
          userAnswers: {} // Optional: reset answers for the new batch
        }));
        setActiveBatchIndex(state.mcqBatches.length);
      } else {
        alert("No more unique questions could be generated for this text.");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to generate more practice questions.");
    } finally {
      setLoadingStates(ls => ({ ...ls, morePractice: false }));
    }
  };

  const closeClarification = () => {
    setClarification(null);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const currentCount = state.images.length;
    const remainingSlots = 5 - currentCount;
    const filesToProcess = files.slice(0, remainingSlots);
    if (filesToProcess.length === 0 && currentCount >= 5) {
      alert("Maximum 5 photos allowed.");
      return;
    }
    try {
      const newBase64Images = await Promise.all(filesToProcess.map(fileToBase64));
      setState(prev => ({ ...prev, error: null, images: [...prev.images, ...newBase64Images] }));
    } catch (error) {
      alert("Failed to load images.");
    }
    if (e.target) e.target.value = '';
  };

  const removeImage = (index: number) => {
    setState(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
  };

  const handleGenerate = async () => {
    if (state.images.length === 0) return;
    setState(prev => ({ 
      ...prev, 
      processing: true, 
      error: null,
      ocrResult: null, 
      mcqBatches: [], 
      flashcards: [], 
      masterNote: null, 
      summary: null, 
      examFinished: false, 
      userAnswers: {}, 
      currentQuestionIndex: 0 
    }));
    setActiveBatchIndex(0);
    setLoadingStates({ ocr: true, notes: true, summary: true, practice: true, flashcards: true, clarification: false, moreBonus: false, morePractice: false });

    try {
      const ocrResult = await extractOCRAndSubject(state.images);
      setState(prev => ({ ...prev, ocrResult, processing: false }));
      setLoadingStates(ls => ({ ...ls, ocr: false }));

      generateMasterNote(ocrResult.ocrText, ocrResult.subject, state.language)
        .then(note => {
          setState(prev => ({ ...prev, masterNote: note }));
          setLoadingStates(ls => ({ ...ls, notes: false }));
        })
        .catch(() => setLoadingStates(ls => ({ ...ls, notes: false })));

      generateSummary(ocrResult.ocrText, ocrResult.ocrText.substring(0, 1000), state.language)
        .then(summaryContent => {
          setState(prev => ({ ...prev, summary: summaryContent }));
          setLoadingStates(ls => ({ ...ls, summary: false }));
        })
        .catch(() => setLoadingStates(ls => ({ ...ls, summary: false })));

      generateMCQBatch(ocrResult.ocrText, state.language, 1)
        .then(batch => {
          setState(prev => ({ ...prev, mcqBatches: [{ batchNumber: 1, questions: batch.questions, coverageReport: batch.coverageReport }] }));
          setLoadingStates(ls => ({ ...ls, practice: false }));
        })
        .catch(() => setLoadingStates(ls => ({ ...ls, practice: false })));

      generateFlashcards(ocrResult.ocrText, state.language)
        .then(cards => {
          setState(prev => ({ ...prev, flashcards: cards }));
          setLoadingStates(ls => ({ ...ls, flashcards: false }));
        })
        .catch(() => setLoadingStates(ls => ({ ...ls, flashcards: false })));

    } catch (error: any) {
      console.error(error);
      setState(prev => ({ 
        ...prev, 
        processing: false, 
        error: error?.message || "Analysis failed. The images might be blurry or the server is busy." 
      }));
      setLoadingStates({ ocr: false, notes: false, summary: false, practice: false, flashcards: false, clarification: false, moreBonus: false, morePractice: false });
    }
  };

  const handleDownloadKit = () => {
    if (!state.ocrResult) return;

    const date = new Date().toLocaleDateString();
    const subject = state.ocrResult.subject || 'StudyKit';
    
    // HTML Template for Export
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Job Cracker - ${subject}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          @media print { .no-print { display: none; } }
          body { font-family: sans-serif; background: #f8fafc; color: #1e293b; }
          .section-card { background: white; border-radius: 1.5rem; padding: 2rem; margin-bottom: 2rem; border: 1px solid #e2e8f0; }
        </style>
      </head>
      <body class="p-8 max-w-4xl mx-auto">
        <header class="mb-12 border-b-2 border-emerald-500 pb-6 flex justify-between items-end">
          <div>
            <h1 class="text-4xl font-black text-slate-900">Job Cracker Study Kit</h1>
            <p class="text-emerald-600 font-bold uppercase tracking-widest text-sm mt-2">Subject: ${subject}</p>
          </div>
          <div class="text-right text-slate-400 text-xs font-bold uppercase tracking-widest">
            Generated on ${date}<br/>By Montasir's Job Cracker
          </div>
        </header>

        <section class="section-card">
          <h2 class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
            <span class="w-2 h-8 bg-emerald-500 rounded-full"></span> Master Notes
          </h2>
          <div class="space-y-12">
            <div><h3 class="font-black text-xs uppercase tracking-widest text-emerald-600 mb-4">Layer 1: Book Exact</h3><div class="prose max-w-none text-slate-700 whitespace-pre-wrap">${state.masterNote?.layer1 || 'N/A'}</div></div>
            <div class="bg-blue-50/50 p-6 rounded-2xl"><h3 class="font-black text-xs uppercase tracking-widest text-blue-600 mb-4">Layer 2: Memory Tricks</h3><div class="prose max-w-none text-slate-700 whitespace-pre-wrap">${state.masterNote?.layer2 || 'N/A'}</div></div>
            <div><h3 class="font-black text-xs uppercase tracking-widest text-purple-600 mb-4">Layer 3: Job Prep Bonus</h3><div class="prose max-w-none text-slate-700 whitespace-pre-wrap">${state.masterNote?.layer3 || 'N/A'}</div></div>
          </div>
        </section>

        <section class="section-card">
          <h2 class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
            <span class="w-2 h-8 bg-blue-500 rounded-full"></span> Summary
          </h2>
          <div class="prose max-w-none text-slate-700 whitespace-pre-wrap">${state.summary || 'N/A'}</div>
        </section>

        <section class="section-card">
          <h2 class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
            <span class="w-2 h-8 bg-slate-900 rounded-full"></span> Practice Questions
          </h2>
          <div class="space-y-8">
            ${state.mcqBatches.flatMap(b => b.questions).map((q, idx) => `
              <div class="border-b border-slate-100 pb-6">
                <p class="font-black text-slate-900 mb-3">${idx + 1}. ${q.question}</p>
                <div class="grid grid-cols-2 gap-2 text-sm ml-4 mb-3">
                  <div class="text-slate-600">A. ${q.options.A}</div>
                  <div class="text-slate-600">B. ${q.options.B}</div>
                  <div class="text-slate-600">C. ${q.options.C}</div>
                  <div class="text-slate-600">D. ${q.options.D}</div>
                </div>
                <div class="bg-emerald-50 p-4 rounded-xl text-xs">
                  <span class="font-black text-emerald-700">Correct Answer: ${q.correctAnswer}</span><br/>
                  <span class="text-slate-600 italic mt-1 inline-block">${q.briefExplanation}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <footer class="mt-12 pt-8 border-t border-slate-200 text-center">
          <button onclick="window.print()" class="no-print bg-slate-900 text-white px-8 py-3 rounded-xl font-bold text-sm">Save as PDF</button>
          <p class="text-slate-400 text-[10px] font-bold uppercase tracking-[0.3em] mt-8">Copyright © 2024 Job Cracker by Montasir</p>
        </footer>
      </body>
      </html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `JobCracker_${subject.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h3 key={i} className="text-xl font-bold mt-6 mb-3 text-slate-800 border-l-4 border-emerald-500 pl-3">{line.replace('### ', '')}</h3>;
      if (line.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold mt-8 mb-4 text-slate-900">{line.replace('## ', '')}</h2>;
      if (line.startsWith('# ')) return <h1 key={i} className="text-3xl font-black mt-10 mb-6 text-slate-900">{line.replace('# ', '')}</h1>;
      if (line.startsWith('> ')) return <blockquote key={i} className="border-l-4 border-amber-400 bg-amber-50 p-4 my-4 italic text-amber-800 rounded-r-xl">{line.replace('> ', '')}</blockquote>;
      if (line.includes('🧠 Bonus')) return <p key={i} className="bg-purple-50 p-3 border-l-4 border-purple-500 my-3 text-purple-900 rounded-r-xl shadow-sm">{line}</p>;
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const renderedLine = parts.map((part, pi) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={pi} className="text-emerald-700">{part.slice(2, -2)}</strong>;
        return part;
      });
      return <p key={i} className="my-2 leading-relaxed text-slate-700 selection:bg-emerald-100">{renderedLine}</p>;
    });
  };

  const currentBatch = state.mcqBatches[activeBatchIndex];
  const totalInBatch = currentBatch?.questions?.length || 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-[100] px-4 md:px-6 h-16 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
          </div>
          <h1 className="text-lg font-black text-slate-900 hidden sm:block">Job Cracker by Montasir</h1>
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl overflow-x-auto no-scrollbar max-w-full">
          {(['master', 'summary', 'practice', 'flashcards'] as const).map(tab => (
            <button key={tab} onClick={() => setState(prev => ({ ...prev, activeTab: tab }))} className={`px-4 py-1.5 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${state.activeTab === tab ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}>{tab}</button>
          ))}
        </div>
        <button onClick={() => setState(p => ({ ...p, language: p.language === OutputLanguage.BN ? OutputLanguage.EN : OutputLanguage.BN }))} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold">{state.language}</button>
      </nav>

      {/* Floating Selection Tooltip */}
      {selection && !clarification && !loadingStates.clarification && (
        <button 
          onClick={handleClarify}
          style={{ top: selection.y - 45, left: selection.x }}
          className="fixed z-[200] bg-slate-900 text-white px-4 py-2 rounded-full text-xs font-black shadow-2xl flex items-center gap-2 -translate-x-1/2 animate-in zoom-in duration-200"
        >
          <span className="text-amber-400">💡</span> Clarify
        </button>
      )}

      {/* Clarification Display */}
      {(clarification || loadingStates.clarification) && (
        <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-end md:items-center justify-center p-4" onClick={closeClarification}>
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl animate-in slide-in-from-bottom-10" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <span className="bg-emerald-50 text-emerald-600 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Deep Context Analysis</span>
              <button onClick={closeClarification} className="text-slate-300 hover:text-slate-900 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            {loadingStates.clarification ? (
              <div className="py-12 flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
                <p className="font-bold text-slate-400 text-xs uppercase tracking-[0.2em]">Translating meaning...</p>
              </div>
            ) : clarification && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Meaning of "{selection?.text}"</h4>
                  <p className="text-xl font-black text-slate-900 leading-tight">{clarification.definition}</p>
                </div>
                <div className="h-px bg-slate-100"></div>
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Full Sentence Explanation</h4>
                  <p className="text-slate-600 leading-relaxed italic">"{clarification.fullExplanation}"</p>
                </div>
                <button onClick={closeClarification} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs mt-4">Got it!</button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6">
        {state.error && !state.processing && (
          <div className="max-w-xl mx-auto mt-20 bg-white p-10 rounded-[2.5rem] border border-red-100 shadow-2xl text-center space-y-6 animate-in zoom-in duration-300">
            <div className="bg-red-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-2xl font-black text-slate-900">Something went wrong</h2>
            <p className="text-slate-500 font-medium">{state.error}</p>
            <div className="flex gap-4">
              <button onClick={() => setState(s => ({ ...s, error: null, images: [] }))} className="flex-1 bg-slate-100 text-slate-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs">Clear Images</button>
              <button onClick={handleGenerate} className="flex-1 bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs">Try Again</button>
            </div>
          </div>
        )}

        {!state.ocrResult && !state.processing && !state.error && (
          <div className="max-w-4xl mx-auto mt-12 text-center space-y-12">
             <div className="space-y-4">
              <h2 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight px-4">Master your textbook<br/>in minutes.</h2>
              <p className="text-slate-500 font-medium">Upload up to 5 photos to start. Highlight any text to clarify.</p>
            </div>

            {state.images.length === 0 ? (
              <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-300 bg-white rounded-[2.5rem] p-16 cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/30 transition-all shadow-xl">
                <div className="bg-emerald-100 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto mb-6"><svg className="w-12 h-12 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>
                <p className="text-2xl font-black text-slate-800">Choose Book Photos</p>
                <p className="text-slate-400 mt-2 font-bold tracking-widest text-[10px] md:text-xs uppercase">BCS • Primary • Bank • NTRCA</p>
              </div>
            ) : (
              <div className="space-y-10">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {state.images.map((img, idx) => (
                    <div key={idx} className="group relative aspect-[3/4] rounded-2xl overflow-hidden shadow-lg border-2 border-white ring-1 ring-slate-200">
                      <img src={img} className="w-full h-full object-cover" alt="" />
                      <button onClick={() => removeImage(idx)} className="absolute top-2 right-2 bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                  {state.images.length < 5 && (
                    <button onClick={() => fileInputRef.current?.click()} className="aspect-[3/4] border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-emerald-500 text-slate-400 transition-all">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      <span className="text-[10px] font-black uppercase tracking-widest">Add More</span>
                    </button>
                  )}
                </div>
                <button onClick={handleGenerate} className="bg-emerald-600 text-white px-20 py-5 rounded-[2rem] font-black text-xl shadow-2xl active:scale-95 transition-transform flex items-center justify-center gap-3 mx-auto">
                  <span>Generate Study Kit</span>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                </button>
              </div>
            )}
            <input type="file" ref={fileInputRef} hidden multiple accept="image/*" onChange={handleFileUpload} />
          </div>
        )}

        {state.processing && (
          <div className="mt-40 flex flex-col items-center gap-8 text-center animate-in fade-in duration-500">
            <div className="w-24 h-24 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
            <div className="space-y-2">
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">Analysing Knowledge...</h3>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Processing {state.images.length} pages via Gemini AI</p>
            </div>
          </div>
        )}

        {state.ocrResult && !state.error && (
          <div className="space-y-6">
            <div className="bg-white px-8 py-5 rounded-[2rem] border border-slate-200 flex flex-wrap gap-6 items-center justify-between shadow-sm">
              <div className="flex gap-8">
                <div>
                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Subject</span>
                  <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-lg text-sm font-black">{state.ocrResult.subject}</span>
                </div>
                <div className="h-8 w-px bg-slate-100"></div>
                <div>
                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Interactive</span>
                  <span className="text-slate-700 text-sm font-bold flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    Select text to clarify
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleDownloadKit}
                  disabled={!state.masterNote || !state.summary}
                  className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 shadow-lg hover:shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download Kit
                </button>
                <button onClick={() => setState(p => ({ ...p, ocrResult: null, images: [], error: null }))} className="bg-red-50 text-red-500 px-4 py-2 rounded-xl text-xs font-black uppercase">Start New</button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-[3rem] shadow-xl overflow-hidden min-h-[75vh] flex flex-col">
              <div className="flex-1 overflow-y-auto custom-scrollbar no-scrollbar">
                {state.activeTab === 'master' && (
                  <div className="p-10 md:p-16 space-y-12 max-w-4xl mx-auto">
                    {loadingStates.notes && !state.masterNote ? (
                      <div className="py-40 text-center space-y-4">
                         <div className="w-10 h-10 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mx-auto"></div>
                         <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Writing Master Notes...</p>
                      </div>
                    ) : state.masterNote && (
                      <>
                        <section className="space-y-6">
                          <div className="flex items-center gap-3 text-emerald-600 font-black uppercase tracking-widest text-xs"><span className="w-12 h-0.5 bg-emerald-600"></span> Layer 1: Book Exact</div>
                          <div className="bg-slate-50/50 p-10 rounded-[2rem] border border-slate-100">{renderMarkdown(state.masterNote.layer1)}</div>
                        </section>
                        <section className="space-y-6">
                          <div className="flex items-center gap-3 text-blue-600 font-black uppercase tracking-widest text-xs"><span className="w-12 h-0.5 bg-blue-600"></span> Layer 2: Memory Tricks</div>
                          <div className="bg-blue-50/30 p-10 rounded-[2rem] border border-blue-100">{renderMarkdown(state.masterNote.layer2)}</div>
                        </section>
                        <section className="space-y-6">
                          <div className="flex items-center justify-between gap-3 text-purple-600 font-black uppercase tracking-widest text-xs">
                            <div className="flex items-center gap-3"><span className="w-12 h-0.5 bg-purple-600"></span> Layer 3: Job Bonus</div>
                            <button 
                              onClick={handleMoreBonus} 
                              disabled={loadingStates.moreBonus}
                              className="bg-purple-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-purple-700 transition-all disabled:opacity-50"
                            >
                              {loadingStates.moreBonus ? (
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                              )}
                              More Questions
                            </button>
                          </div>
                          <div className="p-10 border border-slate-100 rounded-[2rem] relative">
                            {renderMarkdown(state.masterNote.layer3)}
                            {loadingStates.moreBonus && (
                              <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center rounded-[2rem]">
                                <p className="font-black text-purple-600 uppercase tracking-widest text-xs animate-pulse">Gathering extra high-yield questions...</p>
                              </div>
                            )}
                          </div>
                        </section>
                      </>
                    )}
                  </div>
                )}

                {state.activeTab === 'summary' && (
                  <div className="p-10 md:p-16 max-w-3xl mx-auto">
                    {loadingStates.summary && !state.summary ? (
                       <div className="py-40 text-center space-y-4">
                          <div className="w-10 h-10 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mx-auto"></div>
                          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Condensing Information...</p>
                       </div>
                    ) : state.summary && <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm">{renderMarkdown(state.summary)}</div>}
                  </div>
                )}

                {state.activeTab === 'practice' && (
                  <div className="p-10 md:p-16 max-w-5xl mx-auto">
                    {loadingStates.practice && state.mcqBatches.length === 0 ? (
                       <div className="py-40 text-center space-y-4">
                          <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto"></div>
                          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Creating 50 MCQs...</p>
                       </div>
                    ) : currentBatch ? (
                      <>
                        <div className="flex justify-between items-center mb-10 border-b border-slate-100 pb-4">
                          <div className="flex gap-2">
                            {state.mcqBatches.map((b, i) => (
                              <button 
                                key={i} 
                                onClick={() => { setActiveBatchIndex(i); setState(s => ({ ...s, currentQuestionIndex: 0 })); }}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${activeBatchIndex === i ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}
                              >
                                BATCH {i + 1}
                              </button>
                            ))}
                            <button 
                              onClick={handleGenerateMoreMCQs} 
                              disabled={loadingStates.morePractice}
                              className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white flex items-center gap-2 hover:bg-emerald-700 transition-all disabled:opacity-50"
                            >
                              {loadingStates.morePractice ? (
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              ) : "+ 50 MORE"}
                            </button>
                          </div>
                        </div>

                        <div className="border-b border-slate-100 pb-8 mb-10 relative">
                          {loadingStates.morePractice && (
                            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center rounded-2xl">
                               <p className="font-black text-emerald-600 uppercase tracking-widest text-xs animate-bounce">Generating new batch...</p>
                            </div>
                          )}
                          <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-full mb-3 inline-block">Question {state.currentQuestionIndex + 1} of {totalInBatch}</span>
                          <h3 className="text-2xl md:text-3xl font-black text-slate-900 mt-2 leading-snug">{currentBatch.questions[state.currentQuestionIndex]?.question}</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          {currentBatch.questions[state.currentQuestionIndex] && Object.entries(currentBatch.questions[state.currentQuestionIndex].options).map(([key, value]) => {
                            const qId = currentBatch.questions[state.currentQuestionIndex].id;
                            const answered = !!state.userAnswers[qId];
                            const isCorrect = currentBatch.questions[state.currentQuestionIndex].correctAnswer === key;
                            const isSelected = state.userAnswers[qId] === key;
                            
                            let cls = "border-slate-100 bg-white hover:border-emerald-300";
                            if (answered) {
                              if (isCorrect) cls = "border-emerald-500 bg-emerald-50 text-emerald-700 ring-4 ring-emerald-500/10 scale-[1.02]";
                              else if (isSelected) cls = "border-red-500 bg-red-50 text-red-700";
                              else cls = "opacity-40 border-slate-50";
                            }

                            return (
                              <button key={key} disabled={answered} onClick={() => setState(s => ({ ...s, userAnswers: { ...s.userAnswers, [qId]: key }}))} className={`p-8 rounded-3xl border-2 text-left transition-all relative ${cls}`}>
                                <span className="absolute top-4 right-6 font-black text-4xl opacity-10">{key}</span>
                                <span className="font-bold text-lg">{value}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-12 flex flex-col md:flex-row justify-between items-center gap-6">
                          <button disabled={state.currentQuestionIndex === 0} onClick={() => setState(s => ({ ...s, currentQuestionIndex: s.currentQuestionIndex - 1 }))} className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] disabled:opacity-30">Previous</button>
                          <div className="flex-1 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${((state.currentQuestionIndex + 1) / totalInBatch) * 100}%` }}></div>
                          </div>
                          {state.currentQuestionIndex < totalInBatch - 1 ? (
                            <button onClick={() => setState(s => ({ ...s, currentQuestionIndex: s.currentQuestionIndex + 1 }))} className="bg-emerald-600 text-white px-12 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95">Next Question</button>
                          ) : (
                            <button onClick={() => setState(s => ({ ...s, examFinished: true }))} className="bg-slate-900 text-white px-12 py-4 rounded-2xl font-black uppercase tracking-widest">Finish Exam</button>
                          )}
                        </div>
                      </>
                    ) : <div className="py-40 text-center text-slate-300 font-black uppercase">No practice questions available.</div>}
                  </div>
                )}

                {state.activeTab === 'flashcards' && (
                   <div className="p-10 md:p-16 max-w-4xl mx-auto">
                    {loadingStates.flashcards && !state.flashcards.length ? (
                       <div className="py-40 text-center space-y-4">
                          <div className="w-10 h-10 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mx-auto"></div>
                          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Designing Flashcards...</p>
                       </div>
                    ) : state.flashcards.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {state.flashcards.map((card, i) => (
                          <div key={card.id} className="bg-slate-50 p-10 rounded-[2.5rem] border-2 border-slate-100 hover:border-emerald-300 transition-all flex items-start gap-4">
                            <span className="bg-white text-slate-300 font-black w-10 h-10 rounded-xl flex items-center justify-center shadow-sm text-[10px] shrink-0">{i+1}</span>
                            <p className="font-black text-slate-900 text-lg leading-snug">{card.question}</p>
                          </div>
                        ))}
                      </div>
                    ) : <div className="py-40 text-center text-slate-300 font-black uppercase">Flashcards unavailable.</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
