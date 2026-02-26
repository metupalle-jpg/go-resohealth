'use client';
import { useState } from 'react';
import { ArrowLeft, Upload, Copy, FileText, Sparkles, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';

const filters = ['Vitals','Lab Results','Radiology','Outpatient Notes','Inpatient Notes','Medications','Wellness Programs','Insurance','Epigenetic BioAge','Nutrigenomics','Genetic Testing','Longevity Assessments'];

const timeline = [
  { date: '2025-02-20', category: 'Lab Results', name: 'Complete Blood Count Panel' },
  { date: '2025-02-15', category: 'Radiology', name: 'Chest X-Ray Report' },
  { date: '2025-02-10', category: 'Epigenetic BioAge', name: 'TruAge Biological Age Test' },
];

export default function MyDataPage() {
  const router = useRouter();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const vaultId = '83942A';

  const toggleFilter = (f: string) => setActiveFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  const copyId = () => { navigator.clipboard.writeText(vaultId); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="max-w-md mx-auto bg-white min-h-screen">
      <div className="flex items-center gap-3 p-4 border-b">
        <button onClick={() => router.back()}><ArrowLeft className="w-6 h-6" /></button>
        <div><h1 className="text-xl font-bold">My Data</h1><p className="text-sm text-teal-600">Health Vault</p></div>
      </div>

      <div className="m-4 p-4 bg-gradient-to-r from-teal-500 to-teal-600 rounded-xl text-white">
        <p className="text-xs opacity-80">Your Health Vault ID</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-2xl font-mono font-bold tracking-wider">{vaultId}</span>
          <button onClick={copyId} className="p-2 bg-white/20 rounded-lg">{copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}</button>
        </div>
      </div>

      <div className="m-4 p-6 border-2 border-dashed border-gray-300 rounded-xl text-center cursor-pointer hover:border-teal-400 transition-colors" onClick={() => document.getElementById('fileInput')?.click()}>
        <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="font-medium text-gray-700">Drop files or tap to upload</p>
        <p className="text-xs text-gray-400 mt-1">PDF, JPEG, PNG, HEIC, ZIP, DOC, DOCX</p>
        <input id="fileInput" type="file" className="hidden" accept=".pdf,.jpeg,.jpg,.png,.heic,.zip,.doc,.docx" multiple />
      </div>

      <div className="px-4 pb-2">
        <h2 className="font-semibold text-gray-800 mb-2">Filter by Category</h2>
        <div className="flex flex-wrap gap-2">
          {filters.map(f => (<button key={f} onClick={() => toggleFilter(f)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${activeFilters.includes(f) ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{f}</button>))}
        </div>
      </div>

      <div className="p-4">
        <h2 className="font-semibold text-gray-800 mb-3">Timeline</h2>
        <div className="space-y-3">
          {timeline.map((item, i) => (<div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <FileText className="w-5 h-5 text-teal-500 mt-0.5 shrink-0" />
            <div><p className="font-medium text-sm">{item.name}</p><div className="flex gap-2 mt-1"><span className="text-xs text-gray-400">{item.date}</span><span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">{item.category}</span></div></div>
          </div>))}
        </div>
      </div>

      <div className="m-4 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl">
        <div className="flex items-center gap-2 mb-2"><Sparkles className="w-5 h-5 text-purple-500" /><h3 className="font-semibold text-purple-800">AI Insights</h3></div>
        <p className="text-sm text-purple-600">Upload your health documents to receive personalized AI-powered insights and trend analysis.</p>
      </div>

      <a href="https://wa.me/971501234567" target="_blank" className="fixed bottom-20 right-4 w-14 h-14 bg-green-500 rounded-full flex items-center justify-center shadow-lg hover:bg-green-600 transition-colors z-50">
        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.66 0-3.203-.507-4.489-1.375l-.313-.188-2.772.823.823-2.772-.188-.313A7.962 7.962 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>
      </a>
    </div>
  );
}
