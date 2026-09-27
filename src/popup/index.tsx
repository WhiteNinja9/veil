import { render } from 'preact';
import { AppProvider } from '../ui/app-context';
import { Popup } from './Popup';
import './popup.css';

function Skeleton() {
  return (
    <div class="popup" aria-busy="true">
      <div class="skeleton" style={{ height: '28px', width: '96px' }} />
      <div class="skeleton" style={{ height: '84px', borderRadius: '16px' }} />
      <div class="skeleton" style={{ height: '190px', borderRadius: '16px' }} />
    </div>
  );
}

render(
  <AppProvider fallback={<Skeleton />}>
    <Popup />
  </AppProvider>,
  document.getElementById('app')!,
);
