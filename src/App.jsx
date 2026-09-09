function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F1E4CF] text-[#3A2415] px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-4xl font-serif">keystone</h1>
        <p className="text-sm opacity-80">
          Bite-sized, source-grounded topic learning. Scaffold is up — auth,
          Drive sync, and the search-grounding pipeline come next.
        </p>
      </div>
      <footer className="fixed bottom-2 text-[10px] opacity-50">
        {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
      </footer>
    </div>
  )
}

export default App
