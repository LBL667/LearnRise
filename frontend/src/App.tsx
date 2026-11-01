import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import CommunityPage from './pages/CommunityPage'
import CompetitionDetailPage from './pages/CompetitionDetailPage'
import LeaderboardPage from './pages/LeaderboardPage'
import PrepPage from './pages/PrepPage'
import ProfilePage from './pages/ProfilePage'
import PromotionPage from './pages/PromotionPage'
import TrialPage from './pages/TrialPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<CommunityPage />} />
        <Route path="/competition/:id" element={<CompetitionDetailPage />} />
        <Route path="/prep" element={<PrepPage />} />
        <Route path="/trial" element={<TrialPage />} />
        <Route path="/promo" element={<PromotionPage />} />
        <Route path="/rank" element={<LeaderboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}
