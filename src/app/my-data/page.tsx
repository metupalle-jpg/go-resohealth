''''use client';

import { useState } from 'react';
import { ArrowLeft, Upload, Copy, FileText, Sparkles, Filter } from 'lucide-react';
import Link from 'next/link';

const HealthVault = () => {
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  const filters = [
    'Vitals', 'Lab Results', 'Radiology', 'Outpatient Notes', 'Inpatient Notes',
    'Medications', 'Wellness Programs', 'Insurance', 'Epigenetic BioAge',
    'Nutrigenomics', 'Genetic Testing', 'Longevity Assessments'
  ];

  const toggleFilter = (filter: string) => {
    setActiveFilters(prev =>
      prev.includes(filter) ? prev.filter(f => f !== filter) : [...prev, filter]
    );
  };

  const healthVaultId = '83942A';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(healthVaultId);
    // Add a toast or some feedback for the user
  };

  const timelineEntries = [
    { date: '2023-10-15', type: 'Lab Results', name: 'Comprehensive Metabolic Panel' },
    { date: '2023-09-28', type: 'Radiology', name: 'Chest X-Ray' },
    { date: '2023-09-02', type: 'Vitals', name: 'Annual Physical Vitals' },
  ];

  return (
    <div className="bg-white min-h-screen text-gray-800 max-w-md mx-auto">
      <header className="p-4 border-b border-gray-200">
        <div className="flex items-center">
          <Link href="/" passHref>
            <ArrowLeft className="h-6 w-6 text-gray-600" />
          </Link>
          <div className="ml-4">
            <h1 className="text-xl font-semibold">My Data</h1>
            <p className="text-teal-500">Health Vault</p>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-6">
        <div className="bg-gray-50 p-4 rounded-lg text-center">
          <p className="text-sm text-gray-600">Health Vault ID</p>
          <div className="flex items-center justify-center space-x-2 mt-1">
            <span className="text-2xl font-mono bg-gray-200 px-2 py-1 rounded">{healthVaultId}</span>
            <button onClick={copyToClipboard} className="p-2 rounded-md hover:bg-gray-200">
              <Copy className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="font-semibold text-lg mb-2">Upload Health Documents</p>
          <p className="text-sm text-gray-500 mb-4">PDF, JPEG, PNG, HEIC, ZIP, DOC, DOCX</p>
          <input
            type="file"
            className="hidden"
            id="file-upload"
            accept=".pdf,.jpeg,.jpg,.png,.heic,.zip,.doc,.docx"
            multiple
          />
          <label htmlFor="file-upload" className="cursor-pointer bg-teal-500 text-white px-4 py-2 rounded-md hover:bg-teal-600">
            Choose Files
          </label>
        </div>


        <div>
          <h2 className="text-lg font-semibold flex items-center mb-3">
            <Filter className="h-5 w-5 mr-2 text-gray-500" />
            Filter by Category
          </h2>
          <div className="flex flex-wrap gap-2">
            {filters.map(filter => (
              <button
                key={filter}
                onClick={() => toggleFilter(filter)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  activeFilters.includes(filter)
                    ? 'bg-teal-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">Timeline</h2>
          <div className="space-y-4">
            {timelineEntries.map((entry, index) => (
              <div key={index} className="flex items-start">
                <div className="flex flex-col items-center mr-4">
                  <span className="text-sm font-semibold">{entry.date.split('-')[2]}</span>
                  <span className="text-xs text-gray-500">{new Date(entry.date).toLocaleString('default', { month: 'short' })}</span>
                </div>
                <div className="flex-grow bg-gray-50 p-3 rounded-lg flex items-center">
                  <FileText className="h-6 w-6 text-teal-500 mr-3" />
                  <div>
                    <p className="font-semibold">{entry.name}</p>
                    <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">{entry.type}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center">
          <Sparkles className="h-6 w-6 text-blue-500 mr-3" />
          <div>
            <p className="font-semibold text-blue-800">AI Health Insights</p>
            <p className="text-sm text-blue-600">Insights will appear here after document analysis.</p>
          </div>
        </div>

      </main>

      <div className="fixed bottom-4 right-4">
         <a href="https://wa.me/16502853344" target="_blank" rel="noopener noreferrer" className="bg-green-500 text-white p-4 rounded-full shadow-lg hover:bg-green-600 transition-transform hover:scale-110 flex items-center justify-center">
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
         </a>
      </div>
    </div>
  );
};

export default HealthVault;'''