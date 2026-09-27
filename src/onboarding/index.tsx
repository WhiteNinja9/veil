import { render } from 'preact';
import { AppProvider } from '../ui/app-context';
import { Onboarding } from './Onboarding';
import './onboarding.css';

render(
  <AppProvider>
    <Onboarding />
  </AppProvider>,
  document.getElementById('app')!,
);
