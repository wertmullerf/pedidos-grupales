import { Config } from '@remotion/cli/config';

// La máquina de desarrollo anda justa de memoria: pocos frames en paralelo.
Config.setConcurrency(2);
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
