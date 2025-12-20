@echo off
echo Downloading...
curl -L -# -o Minecraft.zip https://github.com/morettt/my-neuro/releases/download/v1/Minecraft.zip
echo Download completed!
echo Extracting...
powershell -Command "Expand-Archive -Path 'Minecraft.zip' -DestinationPath '.' -Force"
echo Extraction completed!
pause