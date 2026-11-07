import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import AgentsPage from './pages/AgentsPage'
import CommunityPage from './pages/CommunityPage'
import CompetitionDetailPage from './pages/CompetitionDetailPage'
import KnowledgePointPage from './pages/KnowledgePointPage'
import LeaderboardPage from './pages/LeaderboardPage'
import LibraryPage from './pages/LibraryPage'
import LoginPage from './pages/LoginPage'
import PrepPage from './pages/PrepPage'
import ProfilePage from './pages/ProfilePage'
import PromotionPage from './pages/PromotionPage'
import SourceDetailPage from './pages/SourceDetailPage'
import TrialPage from './pages/TrialPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<CommunityPage />} />
        <Route path="/competition/:id" element={<CompetitionDetailPage />} />
        <Route path="/prep" element={<PrepPage />} />
        <Route path="/trial" element={<TrialPage />} />
        <Route path="/review" element={<PrepPage />} />
        <Route path="/promo" element={<PromotionPage />} />
        <Route path="/rank" element={<LeaderboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/kp/:id" element={<KnowledgePointPage />} />
        <Route path="/dashboard" element={<PrepPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/library/:id" element={<SourceDetailPage />} />
        <Route path="/quiz" element={<Navigate to="/prep" replace />} />
        <Route path="/quiz/session" element={<Navigate to="/prep" replace />} />
        <Route path="/practice" element={<PrepPage />} />
        <Route path="/settings/agents" element={<AgentsPage />} />
      </Route>
    </Routes>
  )
}
