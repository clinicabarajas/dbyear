# dBYEAR

Aplicación clínica para analizar series audiométricas longitudinales y clasificar la evolución de la pérdida auditiva por oído.

## Funciones

- Histórico de audiogramas entre 250 y 8.000 Hz.
- Audiogramas superpuestos.
- Evolución temporal del PTA4.
- Cronoaudiograma: cambio en dB/año por frecuencia.
- Pendiente, IC95%, cambio previsto a cuatro años, RMSE y R² descriptivo.
- Importación CSV compatible con las columnas de `IMPOAUDIO`.
- Informe imprimible y exportación CSV.
- Almacenamiento local cifrado mediante AES-GCM.

## Clasificación longitudinal

1. Estable consistente.
2. Tendencia progresiva no confirmada.
3. Progresión sostenida.
4. Trayectoria variable o no lineal.

`Evidencia insuficiente` es un estado de calidad, no una quinta trayectoria.

Los criterios iniciales son provisionales y configurables: cuatro audiogramas, dos años de seguimiento, cambio clínicamente relevante de 5 dB en cuatro años y RMSE máximo de 5 dB. Deben validarse antes de su uso como metodología publicada.

## Uso

Abra `index.html` con un navegador moderno o sirva el directorio mediante un servidor web estático. La aplicación no envía datos clínicos a servidores externos; el almacén cifrado permanece en el navegador del dispositivo.

## Aviso

Prototipo para investigación y apoyo clínico. No es un producto sanitario ni sustituye la valoración profesional.
