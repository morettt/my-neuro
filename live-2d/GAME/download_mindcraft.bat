@echo off
echo Downloading...
curl -L -# -o Minecraft.zip https://github.com/morettt/my-neuro/releases/download/v2.0/Minecraft.zip
echo Download completed!
echo Extracting...
powershell -Command "Expand-Archive -Path 'Minecraft.zip' -DestinationPath '.' -Force"
echo Extraction completed!
pause