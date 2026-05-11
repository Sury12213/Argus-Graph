import { useState, type FC, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

interface Props {
  children: ReactNode;
}

const Layout: FC<Props> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div className="app-layout">
      <Sidebar isOpen={isSidebarOpen} onNavigate={closeSidebar} />
      <button
        className={`sidebar-backdrop ${isSidebarOpen ? 'visible' : ''}`}
        aria-label="Close navigation"
        onClick={closeSidebar}
      />
      <div className="app-main">
        <Header currentPath={location.pathname} onOpenSidebar={() => setIsSidebarOpen(true)} />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
};

export default Layout;

