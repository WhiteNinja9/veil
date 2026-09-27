import { render } from 'preact';
import { AppProvider } from '../ui/app-context';
import { Interstitial } from './Interstitial';
import './interstitial.css';

render(
  <AppProvider>
    <Interstitial />
  </AppProvider>,
  document.getElementById('app')!,
);
